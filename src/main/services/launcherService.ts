import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { app, BrowserWindow, net, shell } from "electron";
import type {
  AccountInfo,
  AddModsResult,
  BackupResult,
  BackupSummary,
  WorldBackup,
  ApplyModsResult,
  BulkDownloadResult,
  DeleteWorldsChoice,
  DisablePlan,
  InstalledVersionInfo,
  InstallProgress,
  JavaListResult,
  LaunchRequest,
  PatchNotes,
  LaunchResult,
  LibraryMod,
  LoaderInfo,
  OrphanWorld,
  Profile,
  ProfileInfo,
  RemoteMatchCard,
  RunningGame,
  ValidationReport,
  VersionListResult,
  WorldInfo,
} from "@shared/launcher";
import { PROFILE_NAME_MAX } from "@shared/launcher";
import { createAccountStore } from "../auth/accountStore";
import { createAccounts } from "../auth/accounts";
import { OFFLINE_PROVIDER_ID } from "../auth/providers/offline";
import { getProvider } from "../auth/registry";
import type { Account } from "../auth/types";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { broadcast } from "../ipc/register";
import { buildLaunchCommand } from "../minecraft/arguments";
import { applyLegacyAssets } from "../minecraft/assets";
import { createDownloader } from "../minecraft/downloader";
import { launchGame } from "../minecraft/gameProcess";
import {
  deleteVersion,
  installVersion,
  isInstalled,
  listDependents,
  readInstallMarker,
  type InstalledVersion,
  type InstallMode,
} from "../minecraft/installer";
import { InstallQueue } from "../minecraft/installQueue";
import {
  installLoader,
  prepareLoader,
  type LoaderInstallRequest,
} from "../minecraft/loaders/installLoader";
import {
  createLoaderRegistry,
  getSupportedGameVersions,
} from "../minecraft/loaders/registry";
import {
  getManifest,
  getVersionList,
  listInstalledVersions,
} from "../minecraft/manifest";
import { createPaths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { ensureJava } from "../minecraft/java";
import {
  isJavaComponent,
  javaUsage,
  listJavaRuntimes,
  removeJavaRuntime,
} from "../minecraft/javaRuntimes";
import { detectSystemJava } from "../minecraft/systemJava";
import { createPatchNotes } from "../minecraft/patchNotes";
import {
  backupDue,
  backupKey,
  createBackup,
  deleteBackup,
  deleteBackupFolder,
  listBackupFolders,
  listBackups,
  pruneBackups,
  restoreBackup,
  type BackupMoment,
} from "../profiles/backups";
import { downloadPlan, storeVersions } from "../modsources/downloadMods";
import { resolveBulk } from "../modsources/bulkFetch";
import { createModSourceRegistry } from "../modsources/registry";
import {
  resolveInstall,
  type InstallPlan,
} from "../modsources/resolveDependencies";
import { acceptedLoaders, checkCompat } from "../profiles/compat";
import { removeTree } from "../profiles/links";
import { createModLibrary, type ModSourceRef } from "../profiles/mods";
import { migrateLegacyGames } from "../profiles/migrate";
import { createProfileStore } from "../profiles/profiles";
import {
  copyProfileWorlds,
  deleteWorld,
  listOrphans,
  listWorlds,
  moveWorld,
  readWorldOwner,
  rescueUnlinkedWorlds,
  syncWorlds,
  worldsOwnedBy,
} from "../profiles/worlds";
import { resolveLaunchSettings } from "../settings/launchSettings";
import { createSettingsStore } from "../settings/settings";
import { collectInput } from "../validation/collect";
import { checkIntegrity } from "../validation/integrity";
import type { ValidationInput } from "../validation/types";
import {
  disableCascade,
  orphanedDependencies,
  validate,
} from "../validation/validate";

/**
 * The composition root for one data folder: wires the Electron-free core
 * (downloads, installs, profiles, worlds, launches) to Electron (network, windows, IPC events).
 */
export function createLauncherService(dataDir: string, logger: Logger) {
  const log = logger.child("launcher");
  const paths = createPaths(dataDir);
  const platform = detectPlatform();
  const downloader = createDownloader({
    // Electron's fetch uses the system proxy settings.
    fetch: (url, init) => net.fetch(url, init),
    userAgent: `ezlauncher/${app.getVersion()}`,
    logger: logger.child("download"),
  });
  const deps = { paths, downloader, platform, logger: log };
  const loaders = createLoaderRegistry({ downloader });
  const loaderDeps = { ...deps, loaders };
  const settings = createSettingsStore(paths.launcherFile("settings.json"));
  const accounts = createAccounts({
    store: createAccountStore(paths.launcherFile("accounts.json")),
    provider: getProvider(OFFLINE_PROVIDER_ID),
    getProvider,
  });
  /** Launches between their checks and the game starting, as `profileId:accountId`. */
  const starting = new Set<string>();
  /** The data folder is being moved: no background work may touch it. */
  let moving = false;
  const profiles = createProfileStore(paths.launcherFile("profiles.json"));
  const mods = createModLibrary({ paths, logger: log });
  const patchNotes = createPatchNotes({ paths, downloader });
  const sources = createModSourceRegistry({
    fetch: (url, init) => net.fetch(url, init),
    // Modrinth asks every app to say who it is.
    userAgent: `ezlauncher/${app.getVersion()} (github.com/Ramin-RX7/ezlauncher)`,
    logger: logger.child("modsources"),
  });
  /** Confirmed-card plans waiting for Download, by plan id. */
  const plans = new Map<
    string,
    {
      plan: InstallPlan;
      profileId: string;
      createdAt: number;
      controller?: AbortController;
    }
  >();
  const PLAN_TTL_MS = 15 * 60 * 1000;
  /** The bulk download in progress (library-wide or per-profile re-apply). */
  let bulk: AbortController | undefined;
  const EMPTY_INPUT: ValidationInput = {
    gameVersion: "",
    loader: null,
    mods: [],
  };
  const queue = new InstallQueue((event) => {
    broadcast("install:state", event);
  });
  const running = new Map<string, RunningGame>();

  const onProgress = (p: InstallProgress): void => {
    broadcast("install:progress", p);
  };
  const changed = (): void => {
    broadcast("profiles:changed", {});
  };

  // ---- Folder work (worlds, profile folders) runs one operation at a time. ----

  let fsQueue: Promise<unknown> = Promise.resolve();
  function serialFs<T>(fn: () => Promise<T>): Promise<T> {
    const run = fsQueue.then(fn, fn);
    fsQueue = run.catch(() => undefined);
    return run;
  }

  const isRunning = (profileId: string): boolean =>
    [...running.values()].some((g) => g.profileId === profileId);

  async function worldOptions() {
    return {
      profileIds: (await profiles.list()).map((p) => p.id),
      isRunning,
    };
  }

  /** World and mod sync for some (default: all) profiles; running ones are skipped. */
  function sync(only?: string[]): Promise<void> {
    return serialFs(async () => {
      const options = { ...(await worldOptions()), ...(only && { only }) };
      const result = await syncWorlds({ paths, logger: log }, options);
      for (const u of result.unlinked)
        log.warn(`world ${u.worldId} of ${u.profileId} isn't linked`);
      if ((await mods.sync(options)) > 0) scheduleIdentify();
    });
  }

  // ---- Identifying mods by hash (Modrinth badge for hand-added jars) ----

  let identifyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ask the mod sources about new jars soon; several adds in a row make one request. */
  function scheduleIdentify(delayMs = 2000): void {
    if (identifyTimer) clearTimeout(identifyTimer);
    if (moving) return;
    identifyTimer = setTimeout(() => {
      identifyTimer = undefined;
      void identifyPending().catch((err: unknown) => {
        log.info('identifying mods failed; they stay "not checked yet"', err);
      });
    }, delayMs);
    identifyTimer.unref();
  }

  /**
   * How a new version of a sourced mod enters the library: as a dependency when every
   * library copy of that project is only a dependency, otherwise as the user's own.
   */
  async function addedAsByProject(): Promise<
    (v: { sourceId: string; projectId: string }) => "user" | "dependency"
  > {
    const user = new Set<string>();
    const dep = new Set<string>();
    for (const m of await mods.list()) {
      if (!m.source) continue;
      const key = `${m.source.sourceId}:${m.source.projectId}`;
      (m.dependency ? dep : user).add(key);
    }
    return (v) => {
      const key = `${v.sourceId}:${v.projectId}`;
      return dep.has(key) && !user.has(key) ? "dependency" : "user";
    };
  }

  async function identifyPending(): Promise<void> {
    const pending = await mods.pendingIdentification();
    if (pending.length === 0) return;
    const matches = new Map<string, ModSourceRef>();
    for (const source of sources.sources) {
      const left = pending.filter((sha1) => !matches.has(sha1));
      if (left.length === 0) break;
      // Offline: throws, and nothing is recorded, so they're asked again next start.
      for (const [sha1, v] of await source.identifyFiles(left)) {
        matches.set(sha1, {
          sourceId: v.sourceId,
          projectId: v.projectId,
          versionId: v.versionId,
          pageUrl: source.pageUrl(v.projectId),
          loaders: v.loaders,
          gameVersions: v.gameVersions,
        });
      }
    }
    const found = await mods.recordIdentification(pending, matches);
    log.info(`identified ${found} of ${pending.length} mods`);
    changed();
  }

  // ---- Mod validation (Scope 05) ----

  const collectDeps = {
    paths,
    library: mods,
    versions: async () => (await getManifest(deps)).cached?.manifest.versions,
  };
  /** The last report per profile, and what it was computed from. */
  const reports = new Map<string, { key: string; report: ValidationReport }>();

  /**
   * Check a profile's enabled mods (the caller syncs first). The quick damage check
   * runs every time; the SHA1 only for files that changed, or for all with `full`.
   */
  async function checkProfileMods(
    profile: Profile,
    { full = false }: { full?: boolean } = {},
  ): Promise<{ input: ValidationInput; report: ValidationReport }> {
    const { input, files } = await collectInput(collectDeps, profile);
    const integrity = await checkIntegrity(files, { full });
    await mods.recordVerified(integrity.verified);
    const checked = { ...input, damaged: integrity.damaged };
    const key = JSON.stringify([
      input.mods.map((m) => m.sha1).sort(),
      input.gameVersion,
      input.mcVersion,
      input.loader,
      input.javaMajor,
      [...integrity.damaged],
    ]);
    const cached = reports.get(profile.id);
    if (cached?.key === key) return { input: checked, report: cached.report };
    const report = validate(checked);
    reports.set(profile.id, { key, report });
    return { input: checked, report };
  }

  // ---- World backups: one job at a time, progress on `backup:progress`. ----

  let backupQueue: Promise<unknown> = Promise.resolve();
  let backupJob: { controller: AbortController } | undefined;
  let backupsWaiting = 0;

  async function pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /** A profile's worlds, with when each was last backed up. */
  async function worldsWithBackups(profileId: string): Promise<WorldInfo[]> {
    const worlds = await listWorlds(paths, profileId);
    return Promise.all(
      worlds.map(async (w) => {
        const backups = await listBackups(paths, backupKey(w, profileId));
        return {
          ...w,
          backupCount: backups.length,
          ...(backups[0] && { lastBackupAt: backups[0].createdAt }),
        };
      }),
    );
  }

  async function findWorld(profileId: string, worldId: string) {
    const world = (await listWorlds(paths, profileId)).find(
      (w) => w.id === worldId,
    );
    if (!world) throw new AppError("WORLD_NOT_FOUND", "World not found.");
    return { world, key: backupKey(world, profileId) };
  }

  async function doBackups(
    profileId: string,
    worldIds: readonly string[] | undefined,
    reason: WorldBackup["reason"],
    beforeStart: boolean,
  ): Promise<BackupResult> {
    const worlds = (await listWorlds(paths, profileId)).filter(
      (w) => !worldIds || worldIds.includes(w.id),
    );
    const result: BackupResult = { created: [], unchanged: [], failed: [] };
    if (worlds.length === 0) return result;
    const retention = await settings.load();
    const controller = new AbortController();
    backupJob = { controller };
    broadcast("backup:state", { status: "running", profileId, beforeStart });
    try {
      for (const [i, w] of worlds.entries()) {
        if (controller.signal.aborted) break;
        const key = backupKey(w, profileId);
        let sent = 0;
        const report = (bytes: number, totalBytes: number) => {
          broadcast("backup:progress", {
            profileId,
            worldId: w.id,
            worldName: w.name,
            index: i + 1,
            total: worlds.length,
            bytes,
            totalBytes,
            beforeStart,
          });
        };
        report(0, 0);
        try {
          const made = await createBackup({
            paths,
            key,
            sourceDir: w.linked
              ? paths.worldDir(w.id)
              : paths.saveLink(profileId, w.id),
            worldName: w.name,
            reason,
            signal: controller.signal,
            onProgress: ({ bytes, totalBytes }) => {
              // At most ~10 updates a second.
              if (Date.now() - sent < 100 && bytes < totalBytes) return;
              sent = Date.now();
              report(bytes, totalBytes);
            },
          });
          if ("backup" in made) result.created.push(w.name);
          else result.unchanged.push(w.name);
          await pruneBackups(paths, key, {
            keepCount: retention.backupKeepCount,
            keepDays: retention.backupKeepDays,
          });
        } catch (err) {
          if (err instanceof AppError && err.code === "CANCELLED") break;
          log.warn(`backing up world ${w.id} of ${profileId} failed`, err);
          result.failed.push({
            name: w.name,
            code: err instanceof AppError ? err.code : "BACKUP_FAILED",
          });
        }
      }
      broadcast("backup:state", {
        status: controller.signal.aborted
          ? "cancelled"
          : result.failed.length > 0
            ? "failed"
            : "done",
        profileId,
        beforeStart,
      });
      return result;
    } finally {
      backupJob = undefined;
      changed();
    }
  }

  /** Queue a backup job; jobs run one after another. */
  function runBackups(
    profileId: string,
    worldIds: readonly string[] | undefined,
    reason: WorldBackup["reason"],
    beforeStart = false,
  ): Promise<BackupResult> {
    backupsWaiting++;
    const run = backupQueue.then(() =>
      doBackups(profileId, worldIds, reason, beforeStart),
    );
    backupQueue = run.catch(() => undefined);
    return run.finally(() => {
      backupsWaiting--;
    });
  }

  /** The automatic backup for this moment, if the settings ask for one (changed worlds only). */
  async function autoBackup(
    profileId: string,
    moment: BackupMoment,
  ): Promise<BackupResult | undefined> {
    const current = await settings.load();
    if (current.backupAuto === "off" || current.backupWhen !== moment)
      return undefined;
    const due = (await worldsWithBackups(profileId)).filter((w) =>
      backupDue(current, w.lastBackupAt, moment),
    );
    if (due.length === 0) return undefined;
    return runBackups(
      profileId,
      due.map((w) => w.id),
      "auto",
      moment === "beforeStart",
    );
  }

  /** Apply the retention settings to every world's backups (the days limit moves with time). */
  async function pruneAllBackups(): Promise<void> {
    const current = await settings.load();
    for (const folder of await listBackupFolders(paths)) {
      await pruneBackups(paths, folder.key, {
        keepCount: current.backupKeepCount,
        keepDays: current.backupKeepDays,
      }).catch((err: unknown) => {
        log.warn(`pruning backups of ${folder.key} failed`, err);
      });
    }
  }

  /** Backups of worlds that no longer exist (deleted in game, or with their profile). */
  async function isOrphanBackup(key: string): Promise<boolean> {
    const at = key.indexOf("~");
    if (at < 0) return !(await pathExists(paths.worldDir(key)));
    try {
      return !(await pathExists(
        paths.saveLink(key.slice(0, at), key.slice(at + 1)),
      ));
    } catch {
      return true;
    }
  }

  // Old per-version game folders become profiles, then every profile's worlds are synced.
  const ready: Promise<void> = (async () => {
    try {
      const created = await serialFs(() =>
        migrateLegacyGames({ paths, profiles, logger: log }),
      );
      if (created.length > 0)
        log.info(`created ${created.length} profiles from old game folders`);
      await sync();
    } catch (err) {
      log.error("startup profile/world sync failed", err);
    }
    await pruneAllBackups().catch((err: unknown) => {
      log.warn("pruning backups failed", err);
    });
    changed();
    scheduleIdentify(0); // mods added while offline
  })();

  async function requireProfile(id: string): Promise<Profile> {
    await ready;
    const profile = await profiles.get(id);
    if (!profile) throw new AppError("PROFILE_NOT_FOUND", "Profile not found.");
    return profile;
  }

  function assertNotRunning(profileId: string): void {
    if (isRunning(profileId))
      throw new AppError("GAME_RUNNING", "Close the game first.");
  }

  // ---- Installs ----

  /** A Java runtime install from Settings; version installs wait for it (same files). */
  let javaInstall:
    | { component: string; controller: AbortController; done: Promise<void> }
    | undefined;
  const afterJava = (): Promise<void> =>
    javaInstall ? javaInstall.done.catch(() => undefined) : Promise.resolve();

  function queueLoaderInstall(
    request: LoaderInstallRequest,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    return queue.enqueue(request.versionId, async (signal) => {
      await afterJava();
      return installLoader(loaderDeps, request, { mode, signal, onProgress });
    });
  }

  /** Install, check or repair an installed version; loader installs go through their loader. */
  async function ensureInstalled(
    versionId: string,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    const loader = (await readInstallMarker(paths, versionId))?.loader;
    if (loader) {
      return queueLoaderInstall(
        {
          providerId: loader.id,
          gameVersion: loader.gameVersion,
          loaderVersion: loader.loaderVersion,
          versionId,
        },
        mode,
      );
    }
    return queue.enqueue(versionId, async (signal) => {
      await afterJava();
      return installVersion(deps, versionId, { mode, signal, onProgress });
    });
  }

  /**
   * The installed version a profile plays, installing it first if needed.
   * An install the profile already has stays on its build; a loader profile reuses
   * an existing install of that loader for its Minecraft version.
   */
  async function ensureProfileInstall(
    profile: Profile,
  ): Promise<{ versionId: string; installed: InstalledVersion }> {
    const current = profile.installedVersionId;
    if (current && (await isInstalled(paths, current))) {
      return {
        versionId: current,
        installed: await ensureInstalled(current, "quick"),
      };
    }
    const { gameVersion, loader } = profile;
    if (!loader) {
      const mode = (await isInstalled(paths, gameVersion))
        ? "quick"
        : "install";
      return {
        versionId: gameVersion,
        installed: await ensureInstalled(gameVersion, mode),
      };
    }
    const existing = (await listInstalledVersions(paths)).find(
      (v) => v.loader?.id === loader.id && v.loader.gameVersion === gameVersion,
    );
    if (existing) {
      return {
        versionId: existing.id,
        installed: await ensureInstalled(existing.id, "quick"),
      };
    }
    const request = await prepareLoader(loaderDeps, loader.id, gameVersion);
    return {
      versionId: request.versionId,
      installed: await queueLoaderInstall(request, "install"),
    };
  }

  function assertVersionIdle(versionId: string): void {
    if (queue.isBusy(versionId)) {
      throw new AppError(
        "BUSY",
        "Wait for the install to finish or cancel it first.",
      );
    }
    if ([...running.values()].some((g) => g.versionId === versionId)) {
      throw new AppError("GAME_RUNNING", "Close the game first.");
    }
  }

  /** Also a running game on an install built on this version (e.g. Fabric on 1.18.2). */
  async function assertVersionNotPlayed(versionId: string): Promise<void> {
    assertVersionIdle(versionId);
    for (const g of running.values()) {
      const base = (await readInstallMarker(paths, g.versionId))?.loader
        ?.gameVersion;
      if (base === versionId)
        throw new AppError("GAME_RUNNING", "Close the game first.");
    }
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

  /** Profiles that play each installed version, directly or through a loader install on it. */
  async function versionUsers(): Promise<Map<string, string[]>> {
    const installed = await listInstalledVersions(paths);
    const users = new Map<string, string[]>();
    const add = (versionId: string, profileId: string) => {
      users.set(versionId, [...(users.get(versionId) ?? []), profileId]);
    };
    for (const p of await profiles.list()) {
      const versionId = p.installedVersionId;
      if (!versionId) continue;
      add(versionId, p.id);
      const parent = installed.find((v) => v.id === versionId)?.loader
        ?.gameVersion;
      if (parent) add(parent, p.id);
    }
    return users;
  }

  function validateLoader(loader: unknown): void {
    if (
      loader &&
      typeof loader === "object" &&
      "id" in loader &&
      typeof loader.id === "string"
    ) {
      loaders.get(loader.id); // throws LOADER_UNKNOWN
    }
  }

  // ---- Accounts ----

  function toInfo(a: Account): AccountInfo {
    return { id: a.id, username: a.username, uuid: a.uuid };
  }

  // ---- Misc ----

  async function openFolder(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new AppError("OPEN_FAILED", error);
  }

  function applyOnGameStart(mode: "keep" | "minimize" | "close"): void {
    if (mode === "minimize") {
      for (const w of BrowserWindow.getAllWindows()) w.minimize();
    }
    if (mode === "close") app.quit(); // the game keeps running on its own
  }

  return {
    paths,

    // ---- Versions ----

    listVersions(options: { refresh?: boolean }): Promise<VersionListResult> {
      return getVersionList(deps, options);
    },

    async installedVersions(): Promise<InstalledVersionInfo[]> {
      await ready;
      const [installed, users] = await Promise.all([
        listInstalledVersions(paths),
        versionUsers(),
      ]);
      return Promise.all(
        installed.map(async (v) => ({
          ...v,
          usedBy: users.get(v.id) ?? [],
          dependents: await listDependents(paths, v.id),
        })),
      );
    },

    async installVersion(versionId: string): Promise<void> {
      await ensureInstalled(versionId, "install");
    },

    async repairVersion(versionId: string): Promise<void> {
      await assertVersionNotPlayed(versionId);
      await ensureInstalled(versionId, "repair");
    },

    listLoaders({ refresh }: { refresh?: boolean }): Promise<LoaderInfo[]> {
      return Promise.all(
        loaders.providers.map(async (p) => ({
          id: p.id,
          displayName: p.displayName,
          gameVersions: await getSupportedGameVersions(p, paths, {
            ...(refresh !== undefined && { refresh }),
            logger: log,
          }),
        })),
      );
    },

    cancelInstall(versionId: string): boolean {
      return queue.cancel(versionId);
    },

    /**
     * Delete a version and the installs built on it. Profiles that use them keep
     * working: they reinstall on their next Play.
     */
    /** A version's changelog from Mojang's patch notes (saved after the first look). */
    async versionPatchNotes(versionId: string): Promise<PatchNotes | null> {
      if (typeof versionId !== "string" || versionId.length > 128)
        throw new AppError("VERSION_UNKNOWN", "Unknown version.");
      return patchNotes.get(versionId);
    },

    async deleteVersion(versionId: string, force: boolean): Promise<void> {
      await ready;
      const dependents = await listDependents(paths, versionId);
      const usedBy = (await versionUsers()).get(versionId) ?? [];
      if ((dependents.length > 0 || usedBy.length > 0) && !force) {
        throw new AppError(
          "VERSION_IN_USE",
          `${versionId} is used by profiles or other installs.`,
        );
      }
      for (const id of [...dependents, versionId]) assertVersionIdle(id);
      // Dependents first, so a failure never leaves one without its base version.
      for (const id of dependents) await deleteVersion(paths, id);
      await deleteVersion(paths, versionId);
      changed();
    },

    // ---- Profiles ----

    async listProfiles(): Promise<ProfileInfo[]> {
      await ready;
      return (await profiles.list()).map((p) => ({
        ...p,
        running: [...running.values()].filter((g) => g.profileId === p.id)
          .length,
      }));
    },

    async createProfile(input: unknown): Promise<Profile> {
      await ready;
      validateLoader((input as { loader?: unknown } | null)?.loader);
      const profile = await profiles.create(input);
      await mkdir(paths.gameDir(profile.id), { recursive: true });
      changed();
      return profile;
    },

    /**
     * Copy a profile's settings and enabled mods into a new one (new id). Worlds are
     * owned by id, so the copy starts with none unless `copyWorlds`: then each world
     * is copied and the copies belong to the new profile (the originals are untouched).
     * The install is not copied: the next Play verifies it (version files are shared).
     */
    async duplicateProfile(
      id: string,
      options: { copyWorlds?: boolean } = {},
    ): Promise<Profile> {
      const src = await requireProfile(id);
      const copyWorlds = options.copyWorlds === true;
      // A running game keeps writing its worlds: copying now would catch them half-saved.
      if (copyWorlds) assertNotRunning(id);
      const suffix = " (copy)";
      const name = `${src.name.slice(0, PROFILE_NAME_MAX - suffix.length)}${suffix}`;
      const profile = await profiles.create({
        name,
        gameVersion: src.gameVersion,
        loader: src.loader,
        ...(src.iconId !== undefined && { iconId: src.iconId }),
        ...(src.memoryMaxMb !== undefined && { memoryMaxMb: src.memoryMaxMb }),
        ...(src.extraJvmArgs !== undefined && {
          extraJvmArgs: src.extraJvmArgs,
        }),
        ...(src.extraGameArgs !== undefined && {
          extraGameArgs: src.extraGameArgs,
        }),
      });
      await mkdir(paths.gameDir(profile.id), { recursive: true });
      const sha1s = (await mods.enabledMods(id)).map((m) => m.sha1);
      if (sha1s.length > 0)
        await serialFs(() => mods.enableAll(profile.id, sha1s));
      if (copyWorlds) {
        try {
          const count = await serialFs(() =>
            copyProfileWorlds(paths, id, profile.id),
          );
          log.info(`copied ${count} worlds from ${id} to ${profile.id}`);
        } catch (err) {
          // Nothing half-made: the new profile goes again, the originals were only read.
          await serialFs(async () => {
            await mods.forgetProfile(profile.id);
            await removeTree(paths.gameDir(profile.id)).catch(() => undefined);
            await profiles.remove(profile.id);
          });
          changed();
          throw err;
        }
        await sync([profile.id]); // adopts the copies into worlds/, owned by the copy
      }
      changed();
      return profile;
    },

    async updateProfile(id: string, patch: unknown): Promise<Profile> {
      await requireProfile(id);
      assertNotRunning(id);
      validateLoader((patch as { loader?: unknown } | null)?.loader);
      const profile = await profiles.update(id, patch);
      changed();
      return profile;
    },

    /** Delete a profile. Its worlds are deleted or moved to another profile, as chosen. */
    async deleteProfile(id: string, worlds: DeleteWorldsChoice): Promise<void> {
      await requireProfile(id);
      assertNotRunning(id);
      const moveTo = typeof worlds === "object" ? worlds.moveTo : undefined;
      if (moveTo !== undefined) {
        if (moveTo === id)
          throw new AppError("INVALID_PROFILE", "Pick another profile.");
        await requireProfile(moveTo);
        assertNotRunning(moveTo);
      } else if (worlds !== "delete") {
        throw new AppError(
          "INVALID_PROFILE",
          "Choose what to do with the worlds.",
        );
      }

      await serialFs(async () => {
        if (moveTo) {
          // First the worlds still sitting in saves/ (made in game, not synced yet),
          // so they go to the new owner too.
          await rescueUnlinkedWorlds(paths, id, moveTo);
          const options = await worldOptions();
          for (const worldId of await worldsOwnedBy(paths, id))
            await moveWorld({ paths, logger: log }, worldId, moveTo, options);
        } else {
          const owned = await worldsOwnedBy(paths, id);
          for (const worldId of owned) await deleteWorld(paths, worldId);
        }
        await profiles.remove(id);
        // Never follows links, so worlds linked into this profile can't be touched.
        // Its mods are hard links: the library keeps them.
        await removeTree(paths.gameDir(id));
        await mods.forgetProfile(id);
      });
      if (moveTo) await sync([moveTo]);
      const current = await settings.load();
      if (current.selectedProfileId === id)
        await settings.update({ selectedProfileId: null });
      changed();
    },

    async openProfileFolder(
      id: string,
      folder: "game" | "mods" = "game",
    ): Promise<void> {
      await requireProfile(id);
      await openFolder(
        folder === "mods" ? paths.modsDir(id) : paths.gameDir(id),
      );
    },

    // ---- Worlds ----

    async listWorlds(profileId: string): Promise<WorldInfo[]> {
      await requireProfile(profileId);
      return serialFs(() => worldsWithBackups(profileId));
    },

    // ---- World backups ----

    /** Back up some (default: all) of a profile's worlds; unchanged ones are skipped. */
    async backupWorlds(
      profileId: string,
      worldIds?: string[],
    ): Promise<BackupResult> {
      await requireProfile(profileId);
      // The game writes its worlds while it runs: a backup now could be half-saved.
      assertNotRunning(profileId);
      if (moving) throw new AppError("BUSY", "The data folder is being moved.");
      const ids = Array.isArray(worldIds)
        ? worldIds.filter((id): id is string => typeof id === "string")
        : undefined;
      return runBackups(profileId, ids, "manual");
    },

    cancelBackup(): void {
      backupJob?.controller.abort();
    },

    async listWorldBackups(
      profileId: string,
      worldId: string,
    ): Promise<WorldBackup[]> {
      await requireProfile(profileId);
      const { key } = await findWorld(profileId, worldId);
      return listBackups(paths, key);
    },

    /** Unpack a backup as a new world of the same profile. Resolves to its id. */
    async restoreWorldBackup(
      profileId: string,
      worldId: string,
      backupId: string,
    ): Promise<string> {
      await requireProfile(profileId);
      assertNotRunning(profileId);
      const { key } = await findWorld(profileId, worldId);
      const newId = await serialFs(() =>
        restoreBackup(paths, key, backupId, profileId),
      );
      await sync([profileId]);
      changed();
      return newId;
    },

    async deleteWorldBackup(
      profileId: string,
      worldId: string,
      backupId: string,
    ): Promise<void> {
      await requireProfile(profileId);
      const { key } = await findWorld(profileId, worldId);
      await deleteBackup(paths, key, backupId);
      changed();
    },

    async revealWorldBackup(
      profileId: string,
      worldId: string,
      backupId: string,
    ): Promise<void> {
      await requireProfile(profileId);
      const { key } = await findWorld(profileId, worldId);
      const file = paths.backupFile(key, backupId);
      if (!(await pathExists(file)))
        throw new AppError("BACKUP_NOT_FOUND", "The backup file is missing.");
      shell.showItemInFolder(file);
    },

    async backupSummary(): Promise<BackupSummary> {
      await ready;
      const summary: BackupSummary = {
        count: 0,
        totalBytes: 0,
        orphans: { worlds: 0, count: 0, totalBytes: 0 },
      };
      for (const folder of await listBackupFolders(paths)) {
        const bytes = folder.backups.reduce((n, b) => n + b.sizeBytes, 0);
        summary.count += folder.backups.length;
        summary.totalBytes += bytes;
        if (folder.backups.length > 0 && (await isOrphanBackup(folder.key))) {
          summary.orphans.worlds++;
          summary.orphans.count += folder.backups.length;
          summary.orphans.totalBytes += bytes;
        }
      }
      return summary;
    },

    /** Delete the backups of worlds that no longer exist. */
    async deleteOrphanBackups(): Promise<number> {
      await ready;
      let removed = 0;
      for (const folder of await listBackupFolders(paths)) {
        if (!(await isOrphanBackup(folder.key))) continue;
        await deleteBackupFolder(paths, folder.key);
        removed += folder.backups.length;
      }
      return removed;
    },

    async openBackupsFolder(): Promise<void> {
      await mkdir(paths.backupsDir, { recursive: true });
      await openFolder(paths.backupsDir);
    },

    async moveWorld(worldId: string, toProfileId: string): Promise<void> {
      await requireProfile(toProfileId);
      await serialFs(async () => {
        const from = await readWorldOwner(paths, worldId);
        for (const p of [from, toProfileId]) if (p) assertNotRunning(p);
        await moveWorld(
          { paths, logger: log },
          worldId,
          toProfileId,
          await worldOptions(),
        );
      });
      changed();
    },

    async listOrphanWorlds(): Promise<OrphanWorld[]> {
      await ready;
      const { profileIds } = await worldOptions();
      return serialFs(() => listOrphans(paths, profileIds));
    },

    async openWorldFolder(profileId: string, worldId: string): Promise<void> {
      await requireProfile(profileId);
      const linked = (await listWorlds(paths, profileId)).find(
        (w) => w.id === worldId,
      );
      if (!linked) throw new AppError("WORLD_NOT_FOUND", "World not found.");
      await openFolder(
        linked.linked
          ? paths.worldDir(worldId)
          : paths.saveLink(profileId, worldId),
      );
    },

    // ---- Mods ----

    /** The library (synced first); from a profile's view with its state and compatibility. */
    async modLibrary(profileId?: string): Promise<LibraryMod[]> {
      if (profileId === undefined) {
        await ready;
        await sync();
        return mods.list();
      }
      const profile = await requireProfile(profileId);
      await sync([profileId]);
      return mods.list(profile);
    },

    modIcon: (sha1: string) => mods.icon(sha1),

    /**
     * Add jar files to the library; with a profile, also enable the ones that fit it.
     * Paths come from a file picker or drag and drop: only existing `.jar` files are taken.
     */
    async addMods(
      files: readonly string[],
      profileId?: string,
    ): Promise<AddModsResult> {
      await ready;
      const profile = profileId ? await requireProfile(profileId) : undefined;
      const result: AddModsResult = { added: 0, existing: 0, failed: [] };
      const valid: string[] = [];
      for (const path of files) {
        const fileName = typeof path === "string" ? basename(path) : "?";
        try {
          if (
            typeof path !== "string" ||
            !isAbsolute(path) ||
            !/\.jar$/i.test(path)
          )
            throw new AppError("NOT_A_JAR", "Not a jar file.");
          const info = await stat(path);
          if (!info.isFile() || info.size > 512 * 1024 * 1024)
            throw new AppError("NOT_A_JAR", "Not a jar file.");
          valid.push(path);
        } catch (err) {
          result.failed.push({
            fileName,
            code: err instanceof AppError ? err.code : "NOT_A_JAR",
          });
        }
      }

      const added = await serialFs(() => mods.add(valid));
      for (const item of added) {
        if (item.added) result.added++;
        else result.existing++;
        if (!profile) continue;
        const meta = await mods.meta(item.sha1);
        if (!meta || checkCompat(meta, profile).status === "incompatible") {
          result.failed.push({
            fileName: item.fileName,
            code: "MOD_INCOMPATIBLE",
          });
        } else if (isRunning(profile.id)) {
          result.failed.push({ fileName: item.fileName, code: "GAME_RUNNING" });
        } else {
          await serialFs(() => mods.enable(profile.id, item.sha1));
        }
      }
      if (result.added > 0) scheduleIdentify();
      changed();
      return result;
    },

    /**
     * Exact-name search on the mod sites for this profile's loader and version.
     * Each match comes with what Download would do (dependencies, size, warnings).
     */
    async findRemoteMods(
      profileId: string,
      query: string,
    ): Promise<RemoteMatchCard[]> {
      const profile = await requireProfile(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      const text = typeof query === "string" ? query.trim() : "";
      if (!text || text.length > 100) return [];
      const target = {
        gameVersion: profile.gameVersion,
        loaders: acceptedLoaders(profile.loader.id),
      };
      for (const [id, entry] of plans)
        if (Date.now() - entry.createdAt > PLAN_TTL_MS && !entry.controller)
          plans.delete(id);

      // Hand-added jars count once a site knows them (for "replaces" and reuse): ask now.
      await identifyPending().catch((err: unknown) => {
        log.info("identifying mods before the search failed", err);
      });

      const cards: RemoteMatchCard[] = [];
      for (const source of sources.sources) {
        for (const project of await source.findExact(text, target)) {
          const card: RemoteMatchCard = {
            sourceId: source.id,
            project: {
              projectId: project.projectId,
              name: project.name,
              author: project.author,
              ...(project.iconUrl && { iconUrl: project.iconUrl }),
              pageUrl: project.pageUrl,
              ...(project.downloads !== undefined && {
                downloads: project.downloads,
              }),
            },
            version: null,
            dependencies: [],
            missing: [],
            incompatible: [],
            replaces: [],
            totalSize: 0,
          };
          cards.push(card);
          const version = await source.getCompatibleVersion(
            project.projectId,
            target,
          );
          if (!version) continue;

          const view = await mods.view(profile);
          const plan = await resolveInstall(source, version, target, view);
          const ids = new Set<string>();
          for (const item of plan.items)
            if (item.action === "download" && !item.root)
              ids.add(item.version.projectId);
          for (const m of plan.missing) if (m.projectId) ids.add(m.projectId);
          const names = new Map(
            (await source.getProjects([...ids]).catch(() => [])).map((p) => [
              p.projectId,
              p.name,
            ]),
          );

          card.version = {
            versionNumber: version.versionNumber,
            fileName: version.file.fileName,
          };
          card.dependencies = plan.items.flatMap(
            (item): RemoteMatchCard["dependencies"] => {
              if (item.action === "reuse")
                return [{ name: item.name, action: "reuse" as const }];
              if (item.root) return [];
              return [
                {
                  name:
                    names.get(item.version.projectId) ??
                    item.version.file.fileName,
                  versionNumber: item.version.versionNumber,
                  action: "download" as const,
                },
              ];
            },
          );
          card.missing = plan.missing.map(
            (m) =>
              (m.projectId && names.get(m.projectId)) ??
              m.projectId ??
              m.versionId ??
              "?",
          );
          card.incompatible = plan.incompatible.flatMap((projectId) =>
            view.enabledFromProject(source.id, projectId).map((m) => m.name),
          );
          card.replaces = plan.replaces.map((m) => m.name);
          card.totalSize = plan.totalSize;
          if (plan.missing.length === 0) {
            const planId = randomUUID();
            plans.set(planId, { plan, profileId, createdAt: Date.now() });
            card.planId = planId;
          }
        }
      }
      return cards;
    },

    /** Download a confirmed card: the mod and its dependencies, enabled in the profile. */
    async installRemoteMod(planId: string): Promise<{ replaced: string[] }> {
      const entry = plans.get(planId);
      if (!entry || entry.controller)
        throw new AppError(
          "PLAN_EXPIRED",
          "Search again, then press Download.",
        );
      await requireProfile(entry.profileId);
      assertNotRunning(entry.profileId);
      const controller = new AbortController();
      entry.controller = controller;
      try {
        return await serialFs(() =>
          downloadPlan(
            {
              downloader,
              paths,
              library: mods,
              source: sources.get(entry.plan.sourceId),
            },
            entry.plan,
            entry.profileId,
            {
              signal: controller.signal,
              onProgress: (p) => {
                broadcast("mods:download", { planId, ...p });
              },
            },
          ),
        );
      } finally {
        plans.delete(planId);
        changed();
      }
    },

    cancelRemoteMod(planId: string): boolean {
      const controller = plans.get(planId)?.controller;
      controller?.abort();
      return controller !== undefined;
    },

    /**
     * Download the compatible version of every sourced library mod for a target
     * (version + loader), straight into the store. Mods with no version are skipped.
     */
    async downloadLibraryMods(target: {
      gameVersion: string;
      loaderId: string;
    }): Promise<BulkDownloadResult> {
      await ready;
      if (bulk) throw new AppError("MOD_BULK_BUSY", "A download is running.");
      const gameVersion = target.gameVersion;
      const loaderId = target.loaderId;
      if (typeof gameVersion !== "string" || typeof loaderId !== "string")
        throw new AppError("INVALID_TARGET", "Choose a version and a loader.");
      const modTarget = { gameVersion, loaders: acceptedLoaders(loaderId) };
      // Sourced library mods, grouped by source: projectId → its display name.
      const bySource = new Map<string, Map<string, string>>();
      for (const m of await mods.list()) {
        if (!m.source) continue;
        const byProject =
          bySource.get(m.source.sourceId) ?? new Map<string, string>();
        if (!byProject.has(m.source.projectId))
          byProject.set(m.source.projectId, m.name);
        bySource.set(m.source.sourceId, byProject);
      }
      const addedAs = await addedAsByProject();
      const controller = new AbortController();
      bulk = controller;
      try {
        let downloaded = 0;
        const skipped: { name: string }[] = [];
        for (const [sourceId, byProject] of bySource) {
          const source = sources.get(sourceId);
          const res = await resolveBulk(
            source,
            [...byProject.keys()],
            modTarget,
            controller.signal,
          );
          for (const n of res.none)
            skipped.push({ name: byProject.get(n.projectId) ?? n.projectId });
          if (res.found.length === 0) continue;
          await serialFs(() =>
            storeVersions(
              { downloader, paths, library: mods, source },
              res.found.map((f) => f.version),
              {
                signal: controller.signal,
                onProgress: (p) => {
                  broadcast("mods:bulkProgress", p);
                },
                addedAs,
              },
            ),
          );
          downloaded += res.found.length;
        }
        return { downloaded, skipped };
      } finally {
        bulk = undefined;
        changed();
      }
    },

    /**
     * After a profile's version changed: re-fetch each enabled sourced mod's version
     * for the new target and enable it (replacing the old one). Enabled sourced mods
     * with no compatible version are disabled but kept in the library; enabled mods
     * with no known source can't be re-fetched and are reported unresolved.
     */
    async applyProfileMods(profileId: string): Promise<ApplyModsResult> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      if (bulk) throw new AppError("MOD_BULK_BUSY", "A download is running.");
      const modTarget = {
        gameVersion: profile.gameVersion,
        loaders: acceptedLoaders(profile.loader.id),
      };
      const enabled = await mods.enabledMods(profileId);
      const unresolved = enabled
        .filter((m) => !m.meta.source)
        .map((m) => ({ name: m.meta.name }));
      const bySource = new Map<
        string,
        { projectId: string; sha1: string; name: string }[]
      >();
      for (const m of enabled) {
        if (!m.meta.source) continue;
        const list = bySource.get(m.meta.source.sourceId) ?? [];
        list.push({
          projectId: m.meta.source.projectId,
          sha1: m.sha1,
          name: m.meta.name,
        });
        bySource.set(m.meta.source.sourceId, list);
      }
      const addedAs = await addedAsByProject();
      const controller = new AbortController();
      bulk = controller;
      try {
        let downloaded = 0;
        const disabled: { name: string }[] = [];
        for (const [sourceId, list] of bySource) {
          const source = sources.get(sourceId);
          const res = await resolveBulk(
            source,
            list.map((l) => l.projectId),
            modTarget,
            controller.signal,
          );
          if (res.found.length > 0) {
            await serialFs(() =>
              storeVersions(
                { downloader, paths, library: mods, source },
                res.found.map((f) => f.version),
                {
                  signal: controller.signal,
                  onProgress: (p) => {
                    broadcast("mods:bulkProgress", p);
                  },
                  addedAs,
                },
              ),
            );
            await serialFs(() =>
              mods.enableAll(
                profileId,
                res.found.map((f) => f.version.file.sha1),
              ),
            );
            downloaded += res.found.length;
          }
          const none = new Set(res.none.map((n) => n.projectId));
          for (const l of list) {
            if (!none.has(l.projectId)) continue;
            await serialFs(() => mods.disable(profileId, l.sha1));
            disabled.push({ name: l.name });
          }
        }
        reports.clear();
        return { downloaded, disabled, unresolved };
      } finally {
        bulk = undefined;
        changed();
      }
    },

    cancelBulkDownload(): void {
      bulk?.abort();
    },

    /**
     * Tick or untick a library mod in a profile. Incompatible mods can't be enabled.
     * A mod that another enabled mod needs can't be unticked (`MOD_REQUIRED`); unticking
     * one also disables the dependencies nothing else needs any more.
     */
    async setModEnabled(
      profileId: string,
      sha1: string,
      enabled: boolean,
    ): Promise<{ disabled: string[] }> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (enabled) {
        const meta = await mods.meta(sha1);
        if (!meta)
          throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
        if (checkCompat(meta, profile).status === "incompatible")
          throw new AppError(
            "MOD_INCOMPATIBLE",
            "This mod doesn't fit the profile.",
          );
        await serialFs(() => mods.enable(profileId, sha1));
        return { disabled: [] };
      }
      const { input } = await collectInput(collectDeps, profile);
      const needs = validate(input).requiredBy[sha1] ?? [];
      if (needs.length > 0) {
        const names = input.mods
          .filter((m) => needs.includes(m.sha1))
          .map((m) => m.name);
        throw new AppError("MOD_REQUIRED", `Needed by ${names.join(", ")}.`);
      }
      const orphans = orphanedDependencies(input, sha1);
      await serialFs(async () => {
        for (const id of [sha1, ...orphans]) await mods.disable(profileId, id);
      });
      return { disabled: orphans };
    },

    /** The Mods tab's check: problems of the enabled mods, and which mod needs which. */
    async validateMods(
      profileId: string,
      { full = false }: { full?: boolean } = {},
    ): Promise<ValidationReport> {
      const profile = await requireProfile(profileId);
      if (!profile.loader) return validate(EMPTY_INPUT);
      await sync([profileId]);
      return (await checkProfileMods(profile, { full })).report;
    },

    /** What "Disable problem mods and play" would disable, shown before confirming. */
    async disablePlan(profileId: string): Promise<DisablePlan> {
      const profile = await requireProfile(profileId);
      if (!profile.loader) return { mods: [] };
      await sync([profileId]);
      return disableCascade((await checkProfileMods(profile)).input);
    },

    /** Download a damaged mod again from where it came from, and link it again everywhere. */
    async redownloadMod(sha1: string): Promise<void> {
      await ready;
      const meta = await mods.meta(sha1);
      if (!meta)
        throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
      if (!meta.source)
        throw new AppError("MOD_NO_SOURCE", "No site is known for this mod.");
      for (const id of await mods.usedBy(sha1)) assertNotRunning(id);
      const source = sources.get(meta.source.sourceId);
      const version = await source.getVersion(
        meta.source.versionId,
        undefined,
        sha1,
      );
      if (version.file.sha1 !== sha1)
        throw new AppError(
          "MOD_NO_SOURCE",
          `${source.displayName} no longer has this file.`,
        );
      const tmp = `${paths.modStoreFile(sha1)}.redownload`;
      await serialFs(async () => {
        try {
          await rm(tmp, { force: true });
          await downloader.run([
            { dest: tmp, url: version.file.url, sha1, size: version.file.size },
          ]);
          await mods.replaceStored(sha1, tmp);
        } finally {
          await rm(tmp, { force: true });
        }
      });
      reports.clear();
      changed();
    },

    /** Delete a mod from the library. Asks first (`MOD_IN_USE`) when profiles use it. */
    async removeMod(sha1: string, force: boolean): Promise<void> {
      await ready;
      const users = await mods.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError("MOD_IN_USE", "Profiles use this mod.");
      for (const id of users) assertNotRunning(id);
      await serialFs(() => mods.remove(sha1));
      changed();
    },

    async removeUnusedMods(): Promise<number> {
      await ready;
      await sync();
      const count = await serialFs(() => mods.removeUnused());
      changed();
      return count;
    },

    // ---- Accounts ----

    async listAccounts(): Promise<AccountInfo[]> {
      return (await accounts.list()).map(toInfo);
    },

    /** A new offline account; the name must be free (ignoring case). */
    async addAccount(username: unknown): Promise<AccountInfo> {
      return toInfo(await accounts.add(username));
    },

    /** Rename an account. Its UUID stays, so its stats and advancements stay too. */
    async renameAccount(id: unknown, username: unknown): Promise<AccountInfo> {
      return toInfo(await accounts.rename(id, username));
    },

    /** Remove an account from the launcher; world files are not touched. */
    async removeAccount(id: unknown): Promise<void> {
      if ([...running.values()].some((g) => g.accountId === id))
        throw new AppError("GAME_RUNNING", "Close the game first.");
      await accounts.remove(id);
      const current = await settings.load();
      if (current.selectedAccountId === id)
        await settings.update({ selectedAccountId: null });
    },

    // ---- Settings ----

    getSettings: () => settings.load(),
    async updateSettings(patch: unknown) {
      const next = await settings.update(patch);
      if (
        typeof patch === "object" &&
        patch !== null &&
        ("backupKeepCount" in patch || "backupKeepDays" in patch)
      )
        void pruneAllBackups();
      return next;
    },

    // ---- Games ----

    runningGames: (): RunningGame[] => [...running.values()],

    /** Install or check the profile's version, sync its worlds, and start it as the account. */
    async launch({
      profileId,
      accountId,
      problems = "check",
    }: LaunchRequest): Promise<LaunchResult> {
      let profile = await requireProfile(profileId);
      if (moving) throw new AppError("BUSY", "The data folder is being moved.");
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

        const { versionId, installed } = await ensureProfileInstall(profile);
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
          const { report } = await checkProfileMods(profile);
          if (report.errorCount > 0 && problems === "check")
            return { status: "blocked", report };
          warnings = report.warningCount;
        }

        // The automatic backup before the start. Skipping it (cancel) or a failure
        // never stops the game: the Play bar says which worlds weren't backed up.
        let backupFailed: string[] | undefined;
        if (!isRunning(profile.id)) {
          const backups = await autoBackup(profile.id, "beforeStart").catch(
            (err: unknown) => {
              log.warn("backup before the start failed", err);
              return undefined;
            },
          );
          if (backups && backups.failed.length > 0)
            backupFailed = backups.failed.map((b) => b.name);
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
          launcherVersion: app.getVersion(),
          logger: log,
        });
        log.info(
          `launching profile ${profile.id} (${versionId}) as ${identity.username}`,
        );
        log.debug([command.javaPath, ...command.args].join(" "));

        const handle = await launchGame(command, {
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
        };
        running.set(game.launchId, game);
        handle.onLog((lines) => {
          broadcast("game:log", {
            launchId: game.launchId,
            profileId: profile.id,
            lines,
          });
        });
        handle.onExit(({ code, crashed }) => {
          running.delete(game.launchId);
          log.info(
            `${versionId} exited with code ${String(code)}${crashed ? " (crashed)" : ""}`,
          );
          broadcast("game:exit", {
            launchId: game.launchId,
            profileId: profile.id,
            versionId,
            code,
            crashed,
          });
          // The last game of this profile closed: pick up worlds created or deleted in game.
          if (!isRunning(profile.id)) {
            void sync([profile.id])
              .catch((err: unknown) => {
                log.error("world sync after exit failed", err);
              })
              .then(() => autoBackup(profile.id, "afterExit"))
              .catch((err: unknown) => {
                log.error("backup after the game closed failed", err);
              })
              .finally(changed);
          }
        });
        broadcast("game:started", game);
        await profiles.touchLastPlayed(profile.id);
        changed();

        applyOnGameStart(current.onGameStart);
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

    // ---- Moving the data folder ----

    // ---- Java runtimes (Settings) ----

    /** Mojang runtimes (installed and offered) and Java found on the computer. */
    async listJava(): Promise<JavaListResult> {
      await ready;
      const [{ runtimes, offline }, system] = await Promise.all([
        listJavaRuntimes({ paths, downloader, platform }),
        detectSystemJava({ platform, exclude: [paths.runtimesDir] }),
      ]);
      return { runtimes, system, offline };
    },

    /** Download (or complete) a Mojang Java runtime, checking every file. */
    async installJava(component: string): Promise<void> {
      await ready;
      if (typeof component !== "string" || !isJavaComponent(component))
        throw new AppError("JAVA_UNAVAILABLE", "Unknown Java runtime.");
      if (moving) throw new AppError("BUSY", "The data folder is moving.");
      if (javaInstall)
        throw new AppError("BUSY", "Java is already being installed.");
      if (queue.isAnyBusy())
        throw new AppError("BUSY", "Wait for installs to finish.");
      const controller = new AbortController();
      const done = ensureJava({
        component,
        platform,
        paths,
        downloader,
        mode: "full",
        signal: controller.signal,
        onProgress: (p) => {
          broadcast("java:progress", { component, ...p });
        },
      }).then(() => undefined);
      javaInstall = { component, controller, done };
      try {
        await done;
      } finally {
        javaInstall = undefined;
      }
    },

    cancelJavaInstall(): void {
      javaInstall?.controller.abort();
    },

    /**
     * Delete a Mojang runtime. Versions that use it download it again when played;
     * refused while a game runs on it or something is installing.
     */
    async removeJava(component: string): Promise<void> {
      await ready;
      if (typeof component !== "string" || !isJavaComponent(component))
        throw new AppError("JAVA_UNAVAILABLE", "Unknown Java runtime.");
      if (javaInstall || queue.isAnyBusy())
        throw new AppError("BUSY", "Wait for installs to finish.");
      const users = (await javaUsage(paths)).get(component) ?? [];
      if ([...running.values()].some((g) => users.includes(g.versionId)))
        throw new AppError("GAME_RUNNING", "Close the game first.");
      await removeJavaRuntime(paths, component);
    },

    /**
     * Stop background work so the folder can be moved. Refuses while games run or
     * installs and mod downloads are busy.
     */
    prepareToMove(): void {
      if (running.size > 0 || starting.size > 0)
        throw new AppError("GAME_RUNNING", "Close the game first.");
      if (
        queue.isAnyBusy() ||
        [...plans.values()].some((p) => p.controller) ||
        bulk ||
        javaInstall ||
        backupJob ||
        backupsWaiting > 0
      )
        throw new AppError(
          "BUSY",
          "Wait for installs and downloads to finish.",
        );
      moving = true;
      if (identifyTimer) clearTimeout(identifyTimer);
      identifyTimer = undefined;
    },

    /** The move failed or was cancelled: back to normal on the old folder. */
    resumeAfterMove(): void {
      moving = false;
    },
  };
}

export type LauncherService = ReturnType<typeof createLauncherService>;
