import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventPayload } from "@shared/ipc";
import type {
  LaunchRequest,
  LaunchResult,
  LauncherSettings,
  PlayHistory,
  PlayTargets,
  Profile,
  QuickPlay,
  RunningGame,
  SavedServerList,
  ValidationReport,
} from "@shared/launcher";
import { formatServerAddress, parseServerAddress } from "@shared/serverAddress";
import { getProvider } from "../auth/registry";
import type { Account } from "../auth/types";
import { AppError } from "../core/errors";
import { readJson, writeFileAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import {
  buildLaunchCommand,
  quickPlaySupport,
  type QuickPlayTarget,
} from "../minecraft/arguments";
import { applyLegacyAssets } from "../minecraft/assets";
import type { launchGame } from "../minecraft/gameProcess";
import type { InstalledVersion } from "../minecraft/installer";
import type { Paths } from "../minecraft/paths";
import type { Platform } from "../minecraft/platform";
import {
  createRunningGamesFile,
  processAlive,
} from "../minecraft/runningGames";
import { versionJsonSchema, type VersionManifest } from "../minecraft/schemas";
import { exists } from "../profiles/linkedStore";
import type { ModLibrary } from "../profiles/mods";
import { readServerList } from "../profiles/nbt";
import type { createPlayTime } from "../profiles/playTime";
import type { ProfileStore } from "../profiles/profiles";
import { checkEdits, readServers, writeServers } from "../profiles/serverList";
import { listWorlds } from "../profiles/worlds";
import { resolveLaunchSettings } from "../settings/launchSettings";
import type { ValidationInput } from "../validation/types";
import type { BackupService } from "./backups";
import type { Runtime } from "./runtime";

export interface GameServiceDeps {
  paths: Paths;
  platform: Platform;
  runtime: Runtime;
  settings: { load: () => Promise<LauncherSettings> };
  accounts: {
    get: (id: string) => Promise<Account | undefined>;
    list: () => Promise<Account[]>;
  };
  profiles: Pick<ProfileStore, "setInstalled" | "touchLastPlayed">;
  mods: Pick<ModLibrary, "disable">;
  playTime: Pick<ReturnType<typeof createPlayTime>, "record" | "history">;
  requireProfile: (id: string) => Promise<Profile>;
  /** World, mod and pack sync for some (default: all) profiles. */
  sync: (only?: string[]) => Promise<void>;
  changed: () => void;
  /** The installed version a profile plays, installing it first if needed. */
  ensureProfileInstall: (
    profile: Profile,
  ) => Promise<{ versionId: string; installed: InstalledVersion }>;
  checkProfileMods: (
    profile: Profile,
  ) => Promise<{ input: ValidationInput; report: ValidationReport }>;
  autoBackup: BackupService["autoBackup"];
  /** Mojang's versions from the cached manifest (release dates for Quick Play). */
  manifestVersions: () => Promise<VersionManifest["versions"] | undefined>;
  launchGame: typeof launchGame;
  launcherVersion: string;
  /** Keep the launcher open, minimise it or close it, as the settings say. */
  applyOnGameStart: (mode: LauncherSettings["onGameStart"]) => void;
  started: (game: RunningGame) => void;
  gameLog: (e: EventPayload<"game:log">) => void;
  exited: (e: EventPayload<"game:exit">) => void;
  logger: Logger;
}

/** Starting games, the games that run (also across restarts), play time and Quick Play. */
export function createGameService(deps: GameServiceDeps) {
  const {
    paths,
    platform,
    runtime,
    settings,
    accounts,
    profiles,
    mods,
    playTime,
    requireProfile,
    sync,
    changed,
  } = deps;
  const {
    running,
    startedAt,
    starting,
    serialFs,
    isRunning,
    isBusy,
    assertNotRunning,
  } = runtime;
  const log = deps.logger;

  /** Running games survive a launcher restart through this file. */
  const runningFile = createRunningGamesFile(
    paths.launcherFile("running.json"),
  );
  /** A game's play time, from its start to its end. */
  function recordPlay(
    game: RunningGame,
    from: number,
    to: number,
    approx = false,
  ): void {
    void playTime
      .record(game.profileId, {
        startedAt: from,
        endedAt: to,
        accountId: game.accountId,
        ...(game.quickPlay && { quickPlay: game.quickPlay }),
        ...(approx && { approx: true }),
      })
      .then(changed)
      .catch((err: unknown) => {
        log.warn("saving play time failed", err);
      });
  }
  // While games run, note every minute that they still do: a game that ends while
  // the launcher is closed then counts until the last time it was seen.
  setInterval(() => {
    if (running.size > 0) saveRunning();
  }, 60_000).unref();

  function saveRunning(): void {
    const games = [...running.values()].map((g) => ({
      ...g,
      startedAt: startedAt.get(g.launchId) ?? Date.now(),
    }));
    void runningFile.save(games).catch((err: unknown) => {
      log.warn("saving the running games failed", err);
    });
  }

  // ---- Quick Play ----

  /** A server icon from `servers.dat` (base64 PNG) as a `data:` URL, if it looks like one. */
  function iconDataUrl(base64: string): string | undefined {
    const clean = base64.replace(/\s/g, "");
    return /^[A-Za-z0-9+/=]{1,200000}$/.test(clean)
      ? `data:image/png;base64,${clean}`
      : undefined;
  }

  /** The day Quick Play arrived (23w14a, on the way to 1.20). */
  const QUICK_PLAY_SINCE = "2023-04-05";

  /** Can this profile's Minecraft version start straight into a world? */
  async function worldsQuickPlay(profile: Profile): Promise<boolean> {
    // The version's own JSON says best (it's there once the version is installed).
    const json = await readJson(
      paths.versionJson(profile.gameVersion),
      versionJsonSchema,
    ).catch(() => undefined);
    if (json) return quickPlaySupport(json).worlds;
    const entry = (await deps.manifestVersions())?.find(
      (v) => v.id === profile.gameVersion,
    );
    return entry ? entry.releaseTime >= QUICK_PLAY_SINCE : true;
  }

  /** Check a launch's Quick Play target; resolves to what the command needs. */
  async function checkQuickPlay(
    profileId: string,
    quickPlay: unknown,
  ): Promise<
    | { kind: "world" | "server"; core: QuickPlayTarget; shared: QuickPlay }
    | undefined
  > {
    if (quickPlay === undefined || quickPlay === null) return undefined;
    const q = quickPlay as Partial<Record<string, unknown>>;
    if (q.kind === "world" && typeof q.worldId === "string") {
      const worldId = q.worldId;
      if (!(await listWorlds(paths, profileId)).some((w) => w.id === worldId))
        throw new AppError("WORLD_NOT_FOUND", "World not found.");
      // Another game of the profile may have it open: the game would refuse it.
      if (isRunning(profileId))
        throw new AppError("WORLD_IN_USE", "Close the game first.");
      return {
        kind: "world",
        core: { kind: "world", worldId },
        shared: { kind: "world", worldId },
      };
    }
    if (q.kind === "server" && typeof q.address === "string") {
      const address = parseServerAddress(q.address);
      if (!address)
        throw new AppError("INVALID_ADDRESS", "That isn't a server address.");
      return {
        kind: "server",
        core: { kind: "server", address },
        shared: { kind: "server", address: formatServerAddress(address) },
      };
    }
    throw new AppError("INVALID_ADDRESS", "Unknown Quick Play target.");
  }

  function assertAccountFree(profileId: string, account: Account): void {
    const key = `${profileId}:${account.id}`;
    const playing =
      starting.has(key) ||
      [...running.values()].some(
        (g) => g.profileId === profileId && g.accountId === account.id,
      );
    if (playing)
      throw new AppError(
        "ACCOUNT_PLAYING",
        `${account.username} is already playing this profile.`,
      );
  }

  /** A game closed: forget it, and once a profile's last game is gone, sync and back up. */
  function gameExited(
    game: RunningGame,
    code: number | null,
    crashed: boolean,
  ): void {
    const from = startedAt.get(game.launchId);
    if (from !== undefined) recordPlay(game, from, Date.now());
    running.delete(game.launchId);
    startedAt.delete(game.launchId);
    saveRunning();
    log.info(
      `${game.versionId} exited with code ${String(code)}${crashed ? " (crashed)" : ""}`,
    );
    deps.exited({
      launchId: game.launchId,
      profileId: game.profileId,
      versionId: game.versionId,
      code,
      crashed,
    });
    // The last game of this profile closed: pick up worlds created or deleted in game.
    if (!isRunning(game.profileId)) {
      void sync([game.profileId])
        .catch((err: unknown) => {
          log.error("world sync after exit failed", err);
        })
        .then(() => deps.autoBackup(game.profileId, "afterExit"))
        .catch((err: unknown) => {
          log.error("backup after the game closed failed", err);
        })
        .finally(changed);
    }
  }

  /** A game from before a launcher restart sends no exit event: poll its process. */
  function watchRestored(game: RunningGame): void {
    const timer = setInterval(() => {
      if (processAlive(game.pid)) return;
      clearInterval(timer);
      gameExited(game, null, false);
    }, 2000);
    timer.unref();
  }

  const api = {
    runningGames: (): RunningGame[] => [...running.values()],

    /** A profile's play time and its sessions (newest first), with account names. */
    async playHistory(profileId: string): Promise<PlayHistory> {
      const profile = await requireProfile(profileId);
      const [history, known] = await Promise.all([
        playTime.history(profile.id),
        accounts.list(),
      ]);
      return {
        totalMs: history.totalMs,
        sessions: history.sessions.map((s) => {
          const name = known.find((a) => a.id === s.accountId)?.username;
          return {
            startedAt: new Date(s.startedAt).toISOString(),
            durationMs: s.endedAt - s.startedAt,
            ...(name && { accountName: name }),
            ...(s.quickPlay && { quickPlay: s.quickPlay }),
            ...(s.approx && { approx: true }),
          };
        }),
      };
    },

    /** The game's server list of a profile, for editing (hidden entries aren't shown). */
    async serverList(profileId: string): Promise<SavedServerList> {
      const profile = await requireProfile(profileId);
      const bytes = await readFile(paths.serversFile(profile.id)).catch(
        () => undefined,
      );
      return {
        servers: readServers(bytes ? new Uint8Array(bytes) : undefined).map(
          ({ icon, ...s }) => {
            const url = icon && iconDataUrl(icon);
            return { ...s, ...(url && { icon: url }) };
          },
        ),
        locked: isBusy(profile.id),
      };
    },

    /**
     * Save a profile's server list: the visible servers in this order. Everything else
     * the game keeps in the file stays. Refused while the profile plays (the game
     * rewrites the file).
     */
    async saveServerList(profileId: string, servers: unknown): Promise<void> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profile.id);
      const edits = checkEdits(servers);
      const file = paths.serversFile(profile.id);
      await serialFs(async () => {
        const bytes = await readFile(file).catch(() => undefined);
        const next = writeServers(
          bytes ? new Uint8Array(bytes) : undefined,
          edits,
        );
        // The game's own file as it was before the launcher first changed it.
        const backup = `${file}.ezl-bak`;
        if (bytes && !(await exists(backup)))
          await writeFileAtomic(backup, bytes);
        await mkdir(paths.gameDir(profile.id), { recursive: true });
        await writeFileAtomic(file, next);
      });
      log.info(`saved ${edits.length} servers for ${profile.id}`);
      changed();
    },

    /** What a profile can start straight into: its worlds (1.20+) and the game's server list. */
    async playTargets(profileId: string): Promise<PlayTargets> {
      const profile = await requireProfile(profileId);
      let servers: PlayTargets["servers"] = [];
      try {
        servers = readServerList(await readFile(paths.serversFile(profile.id)))
          .filter((s) => !s.hidden)
          .map((s) => ({
            name: s.name || s.ip,
            address: s.ip,
            ...(s.icon && iconDataUrl(s.icon) && { icon: iconDataUrl(s.icon) }),
          }));
      } catch {
        // No server list yet (never opened Multiplayer), or one the game left damaged.
      }
      return {
        worlds: (await worldsQuickPlay(profile)) ? "yes" : "needsNewer",
        servers,
      };
    },

    /** Install or check the profile's version, sync its worlds, and start it as the account. */
    async launch({
      profileId,
      accountId,
      quickPlay,
      problems = "check",
    }: LaunchRequest): Promise<LaunchResult> {
      let profile = await requireProfile(profileId);
      if (runtime.moving)
        throw new AppError("BUSY", "The data folder is being moved.");
      const target = await checkQuickPlay(profile.id, quickPlay);
      const account =
        typeof accountId === "string"
          ? await accounts.get(accountId)
          : undefined;
      if (!account)
        throw new AppError("NO_ACCOUNT", "Choose an account first.");
      // Several games of one profile are fine, each with its own account.
      assertAccountFree(profile.id, account);
      const startKey = `${profile.id}:${account.id}`;
      starting.add(startKey);
      try {
        const identity = await getProvider(
          account.providerId,
        ).getLaunchIdentity(account);
        const current = await settings.load();

        const { versionId, installed } =
          await deps.ensureProfileInstall(profile);
        if (profile.installedVersionId !== versionId)
          await profiles.setInstalled(profile.id, versionId);

        // A profile that is already running keeps its folders as they are.
        if (!isRunning(profile.id)) await sync([profile.id]);

        // Check the mods. With errors the user decides: see them, disable those mods, or play anyway.
        let warnings = 0;
        if (profile.loader) {
          profile = await requireProfile(profile.id); // with its install recorded
          const id = profile.id;
          if (typeof problems === "object" && !isRunning(id)) {
            const off = Array.isArray(problems.disable)
              ? problems.disable.filter(
                  (s): s is string => typeof s === "string",
                )
              : [];
            await serialFs(async () => {
              for (const sha1 of off) await mods.disable(id, sha1);
            });
          }
          const { report } = await deps.checkProfileMods(profile);
          if (report.errorCount > 0 && problems === "check")
            return { status: "blocked", report };
          warnings = report.warningCount;
        }

        // The automatic backup before the start. Skipping it (cancel) or a failure
        // never stops the game: the Play bar says which worlds weren't backed up.
        let backupFailed: string[] | undefined;
        if (!isRunning(profile.id)) {
          const made = await deps
            .autoBackup(profile.id, "beforeStart")
            .catch((err: unknown) => {
              log.warn("backup before the start failed", err);
              return undefined;
            });
          if (made && made.failed.length > 0)
            backupFailed = made.failed.map((b) => b.name);
        }

        const gameDir = paths.gameDir(profile.id);
        await applyLegacyAssets(
          installed.assetIndex,
          installed.assetIndexId,
          paths,
          gameDir,
        );
        const command = buildLaunchCommand({
          installed,
          identity,
          paths,
          platform,
          gameDir,
          ...resolveLaunchSettings(profile, current),
          launcherName: "ezlauncher",
          launcherVersion: deps.launcherVersion,
          logger: log,
          ...(target && { quickPlay: target.core }),
        });
        log.info(
          `launching profile ${profile.id} (${versionId}) as ${identity.username}${target ? ` into ${target.kind}` : ""}`,
        );
        log.debug([command.javaPath, ...command.args].join(" "));

        const handle = await deps.launchGame(command, {
          // One file per account: two games of a profile never share one.
          logFile: join(
            gameDir,
            "logs",
            `ezlauncher-output-${account.username}.log`,
          ),
        });
        const game: RunningGame = {
          launchId: randomUUID(),
          profileId: profile.id,
          accountId: account.id,
          versionId,
          pid: handle.pid,
          ...(target && { quickPlay: target.shared }),
        };
        running.set(game.launchId, game);
        startedAt.set(game.launchId, Date.now());
        saveRunning();
        handle.onLog((lines) => {
          deps.gameLog({
            launchId: game.launchId,
            profileId: profile.id,
            lines,
          });
        });
        handle.onExit(({ code, crashed }) => {
          gameExited(game, code, crashed);
        });
        deps.started(game);
        await profiles.touchLastPlayed(profile.id);
        changed();

        deps.applyOnGameStart(current.onGameStart);
        return {
          status: "started",
          game,
          warnings,
          ...(backupFailed && { backupFailed }),
        };
      } finally {
        starting.delete(startKey);
      }
    },
  };

  return {
    api,
    /**
     * Games still running from before a restart: their profiles stay untouched
     * and they're watched until they exit. Ones that ended meanwhile count as played.
     */
    async restore(): Promise<void> {
      const restored = await runningFile.restore();
      for (const { startedAt: at, seenAt, ...game } of restored.ended) {
        if (seenAt - at <= 24 * 60 * 60 * 1000)
          recordPlay(game, at, seenAt, true);
      }
      for (const { startedAt: at, ...game } of restored.running) {
        running.set(game.launchId, game);
        startedAt.set(game.launchId, at);
        watchRestored(game);
        log.info(
          `profile ${game.profileId} is still playing (pid ${game.pid})`,
        );
      }
      saveRunning(); // forget the ones that ended meanwhile
    },
  };
}

export type GameService = ReturnType<typeof createGameService>;
