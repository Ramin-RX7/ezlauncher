import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { app, BrowserWindow, net, shell } from "electron";
import type {
  AccountInfo,
  ActivePackRef,
  AddModsResult,
  AddPacksResult,
  LibraryPack,
  PackInstallResult,
  PackRef,
  PackSearchResult,
  ProfilePacks,
  ProfileShaders,
  ShaderInstallResult,
  AddToWorldsResult,
  DataPackInstallResult,
  DataPackWorld,
  WorldDataPacks,
  BackupResult,
  BackupSummary,
  WorldBackup,
  ApplyModsResult,
  ModUpdateCheck,
  ModUpdateResult,
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
  LoaderBuildInfo,
  OrphanWorld,
  PlayHistory,
  PlayTargets,
  SavedServerList,
  StorageReport,
  CleanupResult,
  QuickPlay,
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
import {
  buildLaunchCommand,
  quickPlaySupport,
  type QuickPlayTarget,
} from "../minecraft/arguments";
import { readJson, writeFileAtomic } from "../core/fsAtomic";
import { checkEdits, readServers, writeServers } from "../profiles/serverList";
import { versionJsonSchema } from "../minecraft/schemas";
import { readServerList } from "../profiles/nbt";
import { formatServerAddress, parseServerAddress } from "@shared/serverAddress";
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
import { createPaths, safeId } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import {
  createRunningGamesFile,
  processAlive,
} from "../minecraft/runningGames";
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
import {
  DATAPACK_DOWNLOAD,
  downloadPack,
  SHADER_DOWNLOAD,
} from "../modsources/downloadPack";
import { packCompat } from "../profiles/packs/packMeta";
import { resolveBulk } from "../modsources/bulkFetch";
import { createModSourceRegistry } from "../modsources/registry";
import {
  resolveInstall,
  type InstallPlan,
} from "../modsources/resolveDependencies";
import { acceptedLoaders, checkCompat } from "../profiles/compat";
import { isLink, removeTree } from "../profiles/links";
import { createModLibrary, type ModSourceRef } from "../profiles/mods";
import { readManifest } from "../modpacks/manifest";
import { applyModUpdates, findModUpdates } from "../modsources/modUpdates";
import {
  createPackLibrary,
  dataPackKind,
  imageType,
  shaderPackKind,
  type PackLibrary,
  type PackSourceRef,
} from "../profiles/packs/library";
import {
  createProfileShaders,
  shaderRefSchema,
} from "../profiles/packs/profileShaders";
import type { ReconcileDiff } from "../profiles/linkedStore";
import { createWorldDataPacks } from "../profiles/packs/worldDataPacks";
import type { ProjectType, RemoteVersion } from "../modsources/types";
import {
  predatesDataPacks,
  readGameFormat,
  type GameFormat,
} from "../profiles/packs/packFormat";
import {
  activePacksSchema,
  createProfilePacks,
} from "../profiles/packs/profilePacks";
import { migrateLegacyGames } from "../profiles/migrate";
import { createProfileStore } from "../profiles/profiles";
import { createPlayTime } from "../profiles/playTime";
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
import type { DiagnosticsInput } from "../diagnostics/diagnostics";
import {
  LOG_SECTION_BYTES,
  newestFile,
  readHead,
  readTail,
} from "../diagnostics/logTail";
import { syncScreenshots } from "../profiles/screenshots";
import { createModpackService } from "./modpacks";
import { createProfileShortcut } from "../shortcuts";
import { createStorageService } from "./storage";
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
  /** Profiles whose mod pack is being updated: no game starts meanwhile. */
  const packUpdating = new Set<string>();
  /** The data folder is being moved: no background work may touch it. */
  let moving = false;
  const profiles = createProfileStore(paths.launcherFile("profiles.json"));
  const mods = createModLibrary({ paths, logger: log });
  const packs = createPackLibrary({ paths, logger: log });
  /** Resource formats of installed Minecraft versions, read once from their jars. */
  const formats = new Map<string, GameFormat>();
  async function gameFormat(profile: {
    gameVersion: string;
  }): Promise<GameFormat | undefined> {
    const id = profile.gameVersion;
    const known = formats.get(id);
    if (known) return known;
    try {
      const found = await readGameFormat(paths.clientJar(id), id);
      if (found) formats.set(id, found);
      return found;
    } catch {
      return undefined; // not a version id this launcher can install
    }
  }
  const profilePacks = createProfilePacks({
    paths,
    library: packs,
    gameFormat,
    logger: log,
  });
  const shaders = createPackLibrary({
    paths,
    kind: shaderPackKind(paths),
    logger: log,
  });
  const profileShaders = createProfileShaders({
    paths,
    library: shaders,
    logger: log,
  });
  /** Data packs belong to worlds: this library's keys are world ids. */
  const dataPacks = createPackLibrary({
    paths,
    kind: dataPackKind(paths),
    logger: log,
  });
  const worldDataPacks = createWorldDataPacks({
    paths,
    library: dataPacks,
    logger: log,
  });
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
  const UPDATE_CHECK_TTL_MS = 10 * 60 * 1000;
  /** The bulk download in progress (library-wide or per-profile re-apply). */
  let bulk: AbortController | undefined;
  /** The last mod update check per profile, so Update uses exactly what was shown. */
  const updateChecks = new Map<
    string,
    { at: number; versions: Map<string, RemoteVersion> }
  >();
  /** Resource pack downloads in progress, by project id. */
  const packDownloads = new Map<string, AbortController>();
  /** Shader downloads in progress, by project id. */
  const shaderDownloads = new Map<string, AbortController>();
  /** Data pack downloads in progress, by project id. */
  const dataPackDownloads = new Map<string, AbortController>();
  const EMPTY_INPUT: ValidationInput = {
    gameVersion: "",
    loader: null,
    mods: [],
  };
  const queue = new InstallQueue((event) => {
    broadcast("install:state", event);
  });
  const running = new Map<string, RunningGame>();
  /** When each running game started (epoch ms); saved with it. */
  const startedAt = new Map<string, number>();
  /** Running games survive a launcher restart through this file. */
  const runningFile = createRunningGamesFile(
    paths.launcherFile("running.json"),
  );
  const playTime = createPlayTime(paths.launcherFile("playtime.json"), {
    logger: log,
  });
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

  /** World, mod and pack sync for some (default: all) profiles; running ones are skipped. */
  function sync(only?: string[]): Promise<void> {
    return serialFs(async () => {
      const options = { ...(await worldOptions()), ...(only && { only }) };
      const result = await syncWorlds({ paths, logger: log }, options);
      for (const u of result.unlinked)
        log.warn(`world ${u.worldId} of ${u.profileId} isn't linked`);
      await syncScreenshots({ paths, logger: log }, options);
      if ((await mods.sync(options)) > 0) scheduleIdentify();
      await syncPackKind(options, packs, paths.resourcePacksDir, (p, diff) =>
        profilePacks.followSync(p, diff),
      );
      await syncPackKind(options, shaders, paths.shaderPacksDir, (p, diff) =>
        profileShaders.followSync(p, diff),
      );
      await syncDataPacks(options);
    });
  }

  /** Every world in `worlds/` and the profile that owns it. */
  async function worldOwners(): Promise<Map<string, string | undefined>> {
    let names: string[] = [];
    try {
      names = (await readdir(paths.worldsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // no worlds yet
    }
    const owners = new Map<string, string | undefined>();
    for (const id of names) owners.set(id, await readWorldOwner(paths, id));
    return owners;
  }

  /**
   * Data pack sync, by world: every world is a key (a world that's gone drops its
   * links), only the worlds of `only`'s profiles are reconciled, and a world counts
   * as running when its profile does. The game itself turns new files on.
   */
  async function syncDataPacks(options: {
    profileIds: string[];
    only?: string[];
    isRunning: (id: string) => boolean;
  }): Promise<void> {
    const owners = await worldOwners();
    const only = options.only;
    const worlds = only
      ? [...owners]
          .filter(([, owner]) => owner !== undefined && only.includes(owner))
          .map(([worldId]) => worldId)
      : undefined;
    await syncPackKind(
      {
        profileIds: [...owners.keys()],
        ...(worlds && { only: worlds }),
        isRunning: (worldId) => {
          const owner = owners.get(worldId);
          return owner !== undefined && options.isRunning(owner);
        },
      },
      dataPacks,
      paths.worldDataPacksDir,
      () => Promise.resolve(), // nothing else names a world's packs
    );
  }

  /** Pack sync for one kind; the game's settings follow files renamed by hand. */
  async function syncPackKind(
    options: {
      profileIds: string[];
      only?: string[];
      isRunning: (id: string) => boolean;
    },
    library: PackLibrary,
    folderOf: (profileId: string) => string,
    follow: (profile: Profile, diff: ReconcileDiff) => Promise<void>,
  ): Promise<void> {
    // A pack folder that is itself a link (shared with something else) is left alone.
    const shared = new Set<string>();
    for (const id of options.only ?? options.profileIds)
      if (await isLink(folderOf(id))) shared.add(id);
    const { adopted, diffs } = await library.sync({
      ...options,
      isRunning: (id) => options.isRunning(id) || shared.has(id),
    });
    for (const [id, diff] of diffs) {
      const profile = await profiles.get(id);
      if (!profile) continue;
      await follow(profile, diff).catch((err: unknown) => {
        log.warn(`updating ${id}'s packs after sync failed`, err);
      });
    }
    if (adopted > 0) scheduleIdentify();
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

  /** Ask the mod sources about hand-added mods, resource packs and shaders. */
  async function identifyPending(): Promise<void> {
    const modsAsked = await identifyPendingMods();
    const packsAsked = await identifyPendingPacks(packs, "resourcepack");
    const shadersAsked = await identifyPendingPacks(shaders, "shader");
    const dataPacksAsked = await identifyPendingPacks(dataPacks, "datapack");
    if (modsAsked || packsAsked || shadersAsked || dataPacksAsked) changed();
  }

  async function identifyPendingMods(): Promise<boolean> {
    const pending = await mods.pendingIdentification();
    if (pending.length === 0) return false;
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
    return true;
  }

  /**
   * The same for packs added by hand (Modrinth badge and page link). Shaders have
   * no icon of their own, so they get their project's.
   */
  async function identifyPendingPacks(
    library: PackLibrary,
    projectType: ProjectType,
  ): Promise<boolean> {
    const pending = await library.pendingIdentification();
    if (pending.length === 0) return false;
    const matches = new Map<
      string,
      { source: PackSourceRef; loaders: string[] }
    >();
    for (const source of sources.sources) {
      const left = pending.filter((sha1) => !matches.has(sha1));
      if (left.length === 0) break;
      const found = await source.identifyFiles(left);
      for (const [sha1, v] of found)
        matches.set(sha1, {
          source: {
            sourceId: v.sourceId,
            projectId: v.projectId,
            versionId: v.versionId,
            pageUrl: source.pageUrl(v.projectId, projectType),
          },
          loaders: v.loaders,
        });
      if (projectType === "shader" && found.size > 0) {
        const projects = await source
          .getProjects([
            ...new Set([...found.values()].map((v) => v.projectId)),
          ])
          .catch(() => []);
        for (const [sha1, v] of found) {
          const iconUrl = projects.find(
            (p) => p.projectId === v.projectId,
          )?.iconUrl;
          if (iconUrl) await saveIcon(library, sha1, iconUrl);
        }
      }
    }
    const found = await library.recordIdentification(pending, matches);
    log.info(`identified ${found} of ${pending.length} ${projectType}s`);
    return true;
  }

  /** A pack's icon from its project's page (small images only); failures are ignored. */
  async function saveIcon(
    library: PackLibrary,
    sha1: string,
    url: string,
  ): Promise<void> {
    try {
      if (!url.startsWith("https://")) return;
      const res = await net.fetch(url);
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      await library.setIcon(sha1, bytes);
    } catch (err) {
      log.info(`fetching an icon failed: ${url}`, err);
    }
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

  // ---- Mod packs ----

  /** The loader build a profile plays (pinned, installed, or the newest). */
  async function loaderVersionOf(
    profile: Profile,
  ): Promise<string | undefined> {
    const loader = profile.loader;
    if (!loader) return undefined;
    if (loader.version) return loader.version;
    if (profile.installedVersionId) {
      const marker = await readInstallMarker(paths, profile.installedVersionId);
      if (marker?.loader?.id === loader.id) return marker.loader.loaderVersion;
    }
    const installed = (await listInstalledVersions(paths)).find(
      (v) =>
        v.loader?.id === loader.id &&
        v.loader.gameVersion === profile.gameVersion,
    );
    if (installed?.loader) return installed.loader.loaderVersion;
    return loaders
      .get(loader.id)
      .getLatestLoaderVersion(profile.gameVersion)
      .catch(() => undefined);
  }

  const modpacks = createModpackService({
    paths,
    downloader,
    profiles,
    sources,
    requireProfile,
    assertNotRunning,
    busy: packUpdating,
    serialFs,
    sync,
    forgetProfile: (id) =>
      serialFs(async () => {
        await mods.forgetProfile(id);
        await packs.forgetProfile(id);
        await shaders.forgetProfile(id);
      }),
    loaderVersionOf,
    fetchImage: async (url) => {
      const res = await net.fetch(url);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
    },
    progress: (p) => {
      broadcast("modpacks:progress", p);
    },
    changed,
    logger: log,
  });

  // Old per-version game folders become profiles, then every profile's worlds are synced.
  const ready: Promise<void> = (async () => {
    try {
      // Games still running from before a restart: their profiles stay untouched.
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
      await modpacks.cleanUp().catch((err: unknown) => {
        log.warn("cleaning up after mod pack imports failed", err);
      });
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

  /** A game of this profile is running, or one is being started (or its pack is updating). */
  const isBusy = (profileId: string): boolean =>
    isRunning(profileId) ||
    packUpdating.has(profileId) ||
    [...starting].some((key) => key.startsWith(`${profileId}:`));

  /** Refuse changing a profile's files while a game of it runs or is starting. */
  function assertNotRunning(profileId: string): void {
    if (packUpdating.has(profileId))
      throw new AppError("BUSY", "Wait for the mod pack update to finish.");
    if (isBusy(profileId))
      throw new AppError("GAME_RUNNING", "Close the game first.");
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
    const entry = (await getManifest(deps)).cached?.manifest.versions.find(
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
   * an existing install of that loader for its Minecraft version (of its pinned
   * build, when it has one).
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
      (v) =>
        v.loader?.id === loader.id &&
        v.loader.gameVersion === gameVersion &&
        (loader.version === undefined ||
          v.loader.loaderVersion === loader.version),
    );
    if (existing) {
      return {
        versionId: existing.id,
        installed: await ensureInstalled(existing.id, "quick"),
      };
    }
    const request = await prepareLoader(loaderDeps, loader.id, gameVersion, {
      ...(loader.version !== undefined && { loaderVersion: loader.version }),
    });
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
    broadcast("game:exit", {
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
        .then(() => autoBackup(game.profileId, "afterExit"))
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

  /** Turn library packs on in a profile, at the top (highest priority). */
  async function activatePacks(
    profile: Profile,
    sha1s: readonly string[],
  ): Promise<void> {
    const view = await profilePacks.view(profile, { running: false });
    if (view.locked === "unsupported")
      throw new AppError(
        "PACKS_UNSUPPORTED",
        "This version uses texture packs.",
      );
    if (view.locked)
      throw new AppError(
        "PACKS_VERSION_UNKNOWN",
        "Install or launch this profile once first.",
      );
    const current: ActivePackRef[] = view.active.map((row) =>
      row.kind === "builtin" ? row : row.pack.ref,
    );
    const fresh = sha1s.filter(
      (sha1) => !current.some((r) => r.kind === "library" && r.sha1 === sha1),
    );
    await serialFs(() =>
      profilePacks.setActive(profile, [
        ...fresh.map((sha1) => ({ kind: "library" as const, sha1 })),
        ...current,
      ]),
    );
  }

  /** Whether a profile has a mod turned on (by its id, what it provides, or one inside it). */
  async function hasMod(profileId: string, modId: string): Promise<boolean> {
    const matches = (m: { modId?: string; provides?: string[] }) =>
      m.modId === modId || (m.provides?.includes(modId) ?? false);
    return (await mods.enabledMods(profileId)).some(
      ({ meta }) => matches(meta) || (meta.nested?.some(matches) ?? false),
    );
  }

  /**
   * A world's owner profile, the data pack format that plays it, and whether that
   * version has data packs at all. Worlds still in `saves/` (not synced) aren't found.
   */
  async function dataPackWorld(worldId: unknown) {
    if (typeof worldId !== "string")
      throw new AppError("WORLD_NOT_FOUND", "World not found.");
    let ownerId: string | undefined;
    try {
      ownerId = await readWorldOwner(paths, worldId);
    } catch {
      ownerId = undefined; // not a valid world name
    }
    const profile = ownerId ? await profiles.get(ownerId) : undefined;
    if (!profile) throw new AppError("WORLD_NOT_FOUND", "World not found.");
    const format = await gameFormat(profile);
    return {
      profile,
      context: {
        id: worldId,
        ...(format?.data && { format: format.data }),
        unsupported: predatesDataPacks(profile.gameVersion),
      },
    };
  }

  /** A world whose packs may change now: its profile isn't playing, and its version has data packs. */
  async function editableWorld(worldId: unknown) {
    const world = await dataPackWorld(worldId);
    assertNotRunning(world.profile.id);
    if (world.context.unsupported)
      throw new AppError(
        "DATAPACKS_UNSUPPORTED",
        "This Minecraft version has no data packs.",
      );
    return world;
  }

  /**
   * Check picked or dropped paths (only existing `.zip` files) and add them to a
   * pack library. Resolves to the counts and the SHA1s of the stored zips.
   */
  async function addZips(
    library: PackLibrary,
    files: readonly unknown[],
    notPackCode: string,
  ): Promise<{
    result: AddPacksResult;
    stored: string[];
    storedNames: string[];
  }> {
    const result: AddPacksResult = { added: 0, existing: 0, failed: [] };
    const valid: string[] = [];
    for (const path of files) {
      const fileName = typeof path === "string" ? basename(path) : "?";
      try {
        if (
          typeof path !== "string" ||
          !isAbsolute(path) ||
          !/\.zip$/i.test(path) ||
          !(await stat(path)).isFile()
        )
          throw new AppError(notPackCode, "Not a pack zip.");
        valid.push(path);
      } catch {
        result.failed.push({ fileName, code: notPackCode });
      }
    }
    const added = await serialFs(() => library.add(valid));
    const stored: string[] = [];
    const storedNames: string[] = [];
    for (const item of added) {
      if (!item.ok) {
        result.failed.push({ fileName: item.fileName, code: item.code });
        continue;
      }
      if (item.added) result.added++;
      else result.existing++;
      stored.push(item.sha1);
      storedNames.push(item.fileName);
    }
    return { result, stored, storedNames };
  }

  /** One page of a kind of pack on the first mod site, for a profile's version if given. */
  async function searchSite(
    projectType: ProjectType,
    query: unknown,
    profile: Profile | undefined,
    offset: number,
  ): Promise<PackSearchResult> {
    const source = sources.sources[0];
    if (!source) return { hits: [], total: 0 };
    const page = await source.search(typeof query === "string" ? query : "", {
      projectType,
      ...(profile && { gameVersion: profile.gameVersion }),
      offset: Number.isFinite(offset) ? offset : 0,
      limit: 20,
    });
    return {
      total: page.total,
      hits: page.hits.map((p) => ({
        sourceId: p.sourceId,
        projectId: p.projectId,
        slug: p.slug,
        name: p.name,
        author: p.author,
        pageUrl: p.pageUrl,
        ...(p.description && { description: p.description }),
        ...(p.iconUrl && { iconUrl: p.iconUrl }),
        ...(p.downloads !== undefined && { downloads: p.downloads }),
        ...(p.loaders && { loaders: p.loaders }),
        ...(p.gameVersions && { gameVersions: p.gameVersions }),
      })),
    };
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

  const loaderBuildCache = new Map<string, Promise<LoaderBuildInfo[]>>();

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

  const api = {
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

    /** A loader's builds for a Minecraft version (kept for the session). */
    async loaderBuilds({
      loaderId,
      gameVersion,
    }: {
      loaderId: string;
      gameVersion: string;
    }): Promise<LoaderBuildInfo[]> {
      const provider = loaders.get(loaderId);
      const key = `${provider.id}:${safeId(gameVersion)}`;
      let builds = loaderBuildCache.get(key);
      if (!builds) {
        builds = provider.listLoaderVersions(gameVersion);
        loaderBuildCache.set(key, builds);
        builds.catch(() => loaderBuildCache.delete(key));
      }
      return builds;
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
      const played = await playTime
        .totals()
        .catch(() => new Map<string, number>());
      return (await profiles.list()).map((p) => ({
        ...p,
        playTimeMs: played.get(p.id) ?? 0,
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
      // A mod pack's profile stays one: its pack record, icon and config files come too.
      await serialFs(() => modpacks.copyTo(src, profile)).catch(
        (err: unknown) => {
          log.warn(`copying the mod pack files of ${id} failed`, err);
        },
      );
      // The same active resource packs, in the same order (only those lines of options.txt).
      await serialFs(() => profilePacks.copyActive(src, profile)).catch(
        (err: unknown) => {
          log.warn(`copying the resource packs of ${id} failed`, err);
        },
      );
      // The same shaders with their options, and the same active one.
      await serialFs(() => profileShaders.copyTo(src, profile)).catch(
        (err: unknown) => {
          log.warn(`copying the shaders of ${id} failed`, err);
        },
      );
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
            await packs.forgetProfile(profile.id);
            await shaders.forgetProfile(profile.id);
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

    async setProfilePinned(id: string, pinned: boolean): Promise<void> {
      await profiles.setPinned(id, pinned);
      changed();
    },

    async updateProfile(id: string, patch: unknown): Promise<Profile> {
      const before = await requireProfile(id);
      assertNotRunning(id);
      validateLoader((patch as { loader?: unknown } | null)?.loader);
      const profile = await profiles.update(id, patch);
      if (profile.gameVersion !== before.gameVersion) {
        // Across 1.13 the game names resource packs differently in options.txt.
        const [from, to] = await Promise.all([
          profilePacks.dialectOf(before),
          profilePacks.dialectOf(profile),
        ]);
        if (from && to && from !== to)
          await serialFs(() => profilePacks.translate(profile, from, to)).catch(
            (err: unknown) => {
              log.warn(`updating ${id}'s resource packs failed`, err);
            },
          );
      }
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
          for (const worldId of owned) {
            await deleteWorld(paths, worldId);
            await dataPacks.forgetProfile(worldId); // a moved world keeps its packs
          }
        }
        await profiles.remove(id);
        // Never follows links, so worlds linked into this profile can't be touched.
        // Its mods are hard links: the library keeps them.
        await removeTree(paths.gameDir(id));
        await mods.forgetProfile(id);
        await packs.forgetProfile(id);
        await shaders.forgetProfile(id);
        await modpacks.forgetProfile(id);
        await playTime.forget(id);
        await removeTree(paths.modpackBackupsDir(id)).catch(() => undefined);
        // Its desktop shortcut stays (it opens a "doesn't exist" page); its icon goes.
        for (const ext of ["ico", "png"] as const)
          await rm(paths.shortcutIcon(id, ext), { force: true });
      });
      if (moveTo) await sync([moveTo]);
      const current = await settings.load();
      if (current.selectedProfileId === id)
        await settings.update({ selectedProfileId: null });
      changed();
    },

    /** A desktop shortcut that opens the launcher on this profile; resolves to its path. */
    async createShortcut(
      id: string,
      options: { iconPng?: unknown; description?: unknown },
    ): Promise<string> {
      const profile = await requireProfile(id);
      const description =
        typeof options.description === "string" ? options.description : "";
      const path = await createProfileShortcut({
        paths,
        profile,
        iconPng: options.iconPng,
        description,
      });
      log.info(`made a desktop shortcut for ${profile.id}: ${path}`);
      return path;
    },

    /** A profile's own picture (a mod pack's icon) as a `data:` URL, or null. */
    async profileIcon(id: string): Promise<string | null> {
      const profile = await requireProfile(id);
      if (!profile.customIcon) return null;
      try {
        const bytes = await readFile(paths.profileIcon(profile.id));
        const type = imageType(bytes);
        return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
      } catch {
        return null;
      }
    },

    // ---- Mod packs ----

    modpacks,

    /** Mod packs on the first mod site, 20 at a time (every loader; the UI marks unsupported ones). */
    searchModpacks(query: unknown, offset: number): Promise<PackSearchResult> {
      return searchSite("modpack", query, undefined, offset);
    },

    async openProfileFolder(
      id: string,
      folder: "game" | "mods" | "resourcepacks" | "shaderpacks" = "game",
    ): Promise<void> {
      await requireProfile(id);
      const dirs = {
        game: paths.gameDir,
        mods: paths.modsDir,
        resourcepacks: paths.resourcePacksDir,
        shaderpacks: paths.shaderPacksDir,
      };
      await openFolder(dirs[folder](id));
    },

    /**
     * The data-folder part of "Copy diagnostics": settings, Java, and one profile
     * (the given one, else the selected one) with its mods, mod check and game
     * logs. Never fails: what can't be read is left out.
     */
    async diagnostics(profileId?: string): Promise<
      Pick<DiagnosticsInput, "settings" | "java" | "profile"> & {
        secrets: { dataDir: string; playerNames: string[]; uuids: string[] };
      }
    > {
      const config = await settings.load().catch(() => undefined);
      const accountList = await accounts.list().catch(() => []);
      const javaList = await api.listJava().catch(() => undefined);
      const id = profileId ?? config?.selectedProfileId ?? undefined;
      const profile = id
        ? (await profiles.list().catch(() => [])).find((p) => p.id === id)
        : undefined;

      let profileInfo: DiagnosticsInput["profile"];
      if (profile) {
        const enabled = await mods.enabledMods(profile.id).catch(() => []);
        const report = profile.loader
          ? await api.validateMods(profile.id).catch(() => undefined)
          : undefined;
        const names = new Map(enabled.map((m) => [m.sha1, m.meta.name]));
        const crash = await newestFile(
          join(paths.gameDir(profile.id), "crash-reports"),
        );
        const played = await playTime.totals().catch(() => undefined);
        profileInfo = {
          name: profile.name,
          gameVersion: profile.gameVersion,
          ...(profile.loader && { loader: profile.loader.id }),
          ...(profile.loader?.version && {
            loaderBuild: profile.loader.version,
          }),
          ...(profile.installedVersionId && {
            installedVersionId: profile.installedVersionId,
          }),
          ...(profile.modpack && {
            modpack: `${profile.modpack.name} ${profile.modpack.versionNumber}`,
          }),
          ...(profile.memoryMaxMb !== undefined && {
            memoryMaxMb: profile.memoryMaxMb,
          }),
          ...(profile.extraJvmArgs && {
            extraJvmArgs: profile.extraJvmArgs.length,
          }),
          ...(profile.extraGameArgs && {
            extraGameArgs: profile.extraGameArgs.length,
          }),
          running: isBusy(profile.id),
          ...(played?.get(profile.id) && {
            playTimeMs: played.get(profile.id),
          }),
          mods: enabled
            .map((m) => ({
              name: m.meta.name,
              ...(m.meta.version && { version: m.meta.version }),
              ...(m.meta.modId && { modId: m.meta.modId }),
              fromModrinth: m.meta.source !== undefined,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          issues: (report?.issues ?? []).map(
            (i) =>
              `${i.severity} ${i.code} (${names.get(i.modSha1) ?? i.modSha1.slice(0, 8)})`,
          ),
          ...(crash && {
            crashReport: {
              name: basename(crash.path),
              modifiedAt: crash.modifiedAt.toISOString(),
              head: (await readHead(crash.path, 60, LOG_SECTION_BYTES)) ?? "",
            },
          }),
          ...(await readTail(
            join(paths.gameDir(profile.id), "logs", "latest.log"),
            150,
            LOG_SECTION_BYTES,
          ).then((latestLog) => (latestLog ? { latestLog } : {}))),
        };
      }

      return {
        ...(config && {
          settings: {
            memoryMaxMb: config.memoryMaxMb,
            onGameStart: config.onGameStart,
            extraJvmArgs: config.extraJvmArgs.length,
            extraGameArgs: config.extraGameArgs.length,
          },
        }),
        ...(javaList && {
          java: [
            ...javaList.runtimes
              .filter((r) => r.installed)
              .map(
                (r) =>
                  `Mojang ${r.component}${r.versionName ? ` ${r.versionName}` : ""}`,
              ),
            ...javaList.system.map(
              (s) =>
                `System Java ${s.version ?? "?"}${s.vendor ? ` (${s.vendor})` : ""}`,
            ),
          ],
        }),
        ...(profileInfo && { profile: profileInfo }),
        secrets: {
          dataDir: paths.dataDir,
          playerNames: accountList.map((a) => a.username),
          uuids: accountList.map((a) => a.uuid),
        },
      };
    },

    /** The one folder every profile's screenshots go to. */
    async openScreenshotsFolder(): Promise<void> {
      await openFolder(paths.screenshotsDir);
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

    // ---- Resource packs (Scope 08) ----

    async packLibrary(): Promise<LibraryPack[]> {
      await ready;
      await sync();
      return packs.list();
    },

    packIcon: (sha1: string) => packs.icon(sha1),

    async packFolderIcon(
      profileId: string,
      name: string,
    ): Promise<string | null> {
      await requireProfile(profileId);
      if (typeof name !== "string") return null;
      return profilePacks.folderIcon(profileId, name).catch(() => null);
    },

    /** A profile's Resource packs tab: active packs in order, the rest, and non-packs. */
    async profilePacks(profileId: string): Promise<ProfilePacks> {
      const profile = await requireProfile(profileId);
      const busy = isBusy(profileId);
      if (!busy) await sync([profileId]);
      return profilePacks.view(profile, { running: busy });
    },

    /**
     * Save a profile's active packs (highest priority first) to its options.txt.
     * Never while a game of it runs or starts: the game would overwrite it.
     */
    async setActivePacks(profileId: string, order: unknown): Promise<void> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      const parsed = activePacksSchema.safeParse(order);
      if (!parsed.success)
        throw new AppError("PACK_NOT_FOUND", "That pack list isn't valid.");
      await serialFs(() => profilePacks.setActive(profile, parsed.data));
      changed();
    },

    /**
     * Add pack zips to the library; with a profile, also turn them on there (at the
     * top). Paths come from a file picker or drag and drop: only existing `.zip` files.
     */
    async addPacks(
      files: readonly unknown[],
      profileId?: string,
    ): Promise<AddPacksResult> {
      await ready;
      const profile = profileId ? await requireProfile(profileId) : undefined;
      const { result, stored, storedNames } = await addZips(
        packs,
        files,
        "NOT_A_PACK",
      );
      if (profile && stored.length > 0) {
        let code: string | undefined;
        if (isBusy(profile.id)) code = "GAME_RUNNING";
        else
          await activatePacks(profile, stored).catch((err: unknown) => {
            code = err instanceof AppError ? err.code : "INTERNAL";
          });
        if (code)
          for (const fileName of storedNames)
            result.failed.push({ fileName, code });
      }
      changed();
      return result;
    },

    /** Delete a pack from the library and every profile (`force` when profiles have it). */
    async removePack(sha1: string, force: boolean): Promise<void> {
      await ready;
      const users = await packs.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError("PACK_IN_USE", "Profiles still use this pack.");
      // A running game keeps its active packs open (locked on Windows).
      for (const id of users) assertNotRunning(id);
      await serialFs(() => packs.remove(sha1));
      changed();
    },

    async removeUnusedPacks(): Promise<number> {
      await ready;
      await sync();
      const count = await serialFs(() => packs.removeUnused());
      changed();
      return count;
    },

    /** Packs on the mod sites matching `query`, for the profile's Minecraft version if given. */
    async searchPacks(
      query: string,
      profileId: string | undefined,
      offset: number,
    ): Promise<PackSearchResult> {
      const profile = profileId ? await requireProfile(profileId) : undefined;
      return searchSite("resourcepack", query, profile, offset);
    },

    /** Download a pack into the library; with a profile, turn it on there (at the top). */
    async installPack(
      sourceId: string,
      projectId: string,
      profileId?: string,
    ): Promise<PackInstallResult> {
      await ready;
      const profile = profileId ? await requireProfile(profileId) : undefined;
      if (packDownloads.has(projectId))
        throw new AppError("BUSY", "This pack is already downloading.");
      const controller = new AbortController();
      packDownloads.set(projectId, controller);
      try {
        const result = await downloadPack(
          { downloader, library: packs, source: sources.get(sourceId) },
          projectId,
          {
            ...(profile && { gameVersion: profile.gameVersion }),
            signal: controller.signal,
            onProgress: (p) => {
              broadcast("resourcePacks:download", {
                projectId,
                bytes: p.bytes,
                totalBytes: p.totalBytes,
              });
            },
          },
        );
        let activated = false;
        if (profile && !isBusy(profile.id)) {
          activated = await activatePacks(profile, [result.sha1]).then(
            () => true,
            () => false,
          );
        }
        const meta = await packs.meta(result.sha1);
        const format = profile ? await gameFormat(profile) : undefined;
        changed();
        return {
          sha1: result.sha1,
          name: (meta?.fileName ?? result.version.file.fileName).replace(
            /\.zip$/i,
            "",
          ),
          versionNumber: result.version.versionNumber,
          compat: packCompat(meta?.range, format?.resource),
          otherVersion: result.otherVersion,
          activated,
          needs: result.needs,
        };
      } finally {
        packDownloads.delete(projectId);
      }
    },

    cancelPackInstall(projectId: string): boolean {
      const controller = packDownloads.get(projectId);
      controller?.abort();
      return controller !== undefined;
    },

    // ---- Data packs (per world) ----

    async dataPackLibrary(): Promise<LibraryPack[]> {
      await ready;
      await sync();
      return dataPacks.list();
    },

    dataPackIcon: (sha1: string) => dataPacks.icon(sha1),

    async dataPackFolderIcon(
      worldId: string,
      name: string,
    ): Promise<string | null> {
      await ready;
      if (typeof worldId !== "string" || typeof name !== "string") return null;
      return worldDataPacks.folderIcon(worldId, name).catch(() => null);
    },

    /** A world's Data packs dialog: its packs, the library's others, and non-packs. */
    async worldDataPacks(worldId: string): Promise<WorldDataPacks> {
      await ready;
      const { profile, context } = await dataPackWorld(worldId);
      const busy = isBusy(profile.id);
      if (!busy) await sync([profile.id]);
      return worldDataPacks.view(context, { running: busy });
    },

    /**
     * Put a library pack in a world, or take it out. Never while the world's
     * profile plays: the game keeps the world's packs open.
     */
    async setDataPackInWorld(
      worldId: string,
      sha1: string,
      present: boolean,
    ): Promise<void> {
      await ready;
      await editableWorld(worldId);
      if (typeof sha1 !== "string" || !/^[0-9a-f]{40}$/.test(sha1))
        throw new AppError("DATAPACK_NOT_FOUND", "That data pack isn't valid.");
      await serialFs(() =>
        present
          ? worldDataPacks.add(worldId, sha1)
          : worldDataPacks.remove(worldId, sha1),
      );
      changed();
    },

    /** Every world (by profile), with whether it has this pack, for "Add to worlds…". */
    async dataPackWorlds(sha1: string): Promise<DataPackWorld[]> {
      await ready;
      const users =
        typeof sha1 === "string" ? await dataPacks.usedBy(sha1) : [];
      const worlds: DataPackWorld[] = [];
      for (const p of await profiles.list())
        for (const w of await listWorlds(paths, p.id))
          if (w.linked)
            worlds.push({
              worldId: w.id,
              name: w.name,
              profileId: p.id,
              profileName: p.name,
              hasPack: users.includes(w.id),
              busy: isBusy(p.id),
              unsupported: predatesDataPacks(p.gameVersion),
            });
      return worlds;
    },

    /** Put a library pack in several worlds; ones that can't change now are reported. */
    async addDataPackToWorlds(
      sha1: string,
      worldIds: readonly unknown[],
    ): Promise<AddToWorldsResult> {
      await ready;
      const result: AddToWorldsResult = { added: [], failed: [] };
      for (const worldId of Array.isArray(worldIds) ? worldIds : []) {
        if (typeof worldId !== "string") continue;
        try {
          await editableWorld(worldId);
          await serialFs(() => worldDataPacks.add(worldId, sha1));
          result.added.push(worldId);
        } catch (err) {
          result.failed.push({
            worldId,
            code: err instanceof AppError ? err.code : "INTERNAL",
          });
        }
      }
      changed();
      return result;
    },

    /** Add data pack zips to the library; with a world, also put them there. */
    async addDataPacks(
      files: readonly unknown[],
      worldId?: string,
    ): Promise<AddPacksResult> {
      await ready;
      const world = worldId ? await dataPackWorld(worldId) : undefined;
      const { result, stored, storedNames } = await addZips(
        dataPacks,
        files,
        "NOT_A_DATAPACK",
      );
      if (world && worldId && stored.length > 0) {
        let code: string | undefined;
        try {
          await editableWorld(worldId);
          await serialFs(async () => {
            for (const sha1 of stored) await worldDataPacks.add(worldId, sha1);
          });
        } catch (err) {
          code = err instanceof AppError ? err.code : "INTERNAL";
        }
        if (code)
          for (const fileName of storedNames)
            result.failed.push({ fileName, code });
      }
      changed();
      return result;
    },

    /** Delete a data pack from the library and every world (`force` when worlds have it). */
    async removeDataPack(sha1: string, force: boolean): Promise<void> {
      await ready;
      const users = await dataPacks.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError("DATAPACK_IN_USE", "Worlds still have this pack.");
      // A world being played keeps its packs open (locked on Windows).
      for (const worldId of users) {
        const owner = await readWorldOwner(paths, worldId).catch(
          () => undefined,
        );
        if (owner) assertNotRunning(owner);
      }
      await serialFs(() => dataPacks.remove(sha1));
      changed();
    },

    async removeUnusedDataPacks(): Promise<number> {
      await ready;
      await sync();
      const count = await serialFs(() => dataPacks.removeUnused());
      changed();
      return count;
    },

    /** Data packs on the mod sites matching `query`, for the world's Minecraft version if given. */
    async searchDataPacks(
      query: string,
      worldId: string | undefined,
      offset: number,
    ): Promise<PackSearchResult> {
      await ready;
      const world = worldId ? await dataPackWorld(worldId) : undefined;
      return searchSite("datapack", query, world?.profile, offset);
    },

    /** Download a data pack into the library; with a world, put it there too. */
    async installDataPack(
      sourceId: string,
      projectId: string,
      worldId?: string,
    ): Promise<DataPackInstallResult> {
      await ready;
      const world = worldId ? await dataPackWorld(worldId) : undefined;
      if (dataPackDownloads.has(projectId))
        throw new AppError("BUSY", "This pack is already downloading.");
      const controller = new AbortController();
      dataPackDownloads.set(projectId, controller);
      try {
        const result = await downloadPack(
          { downloader, library: dataPacks, source: sources.get(sourceId) },
          projectId,
          {
            ...(world && { gameVersion: world.profile.gameVersion }),
            kind: DATAPACK_DOWNLOAD,
            signal: controller.signal,
            onProgress: (p) => {
              broadcast("dataPacks:download", {
                projectId,
                bytes: p.bytes,
                totalBytes: p.totalBytes,
              });
            },
          },
        );
        if (result.project?.iconUrl)
          await saveIcon(dataPacks, result.sha1, result.project.iconUrl);
        let added = false;
        if (worldId && world) {
          added = await editableWorld(worldId)
            .then(() =>
              serialFs(() => worldDataPacks.add(worldId, result.sha1)),
            )
            .then(
              () => true,
              () => false,
            );
        }
        const meta = await dataPacks.meta(result.sha1);
        changed();
        return {
          sha1: result.sha1,
          name: (meta?.fileName ?? result.version.file.fileName).replace(
            /\.zip$/i,
            "",
          ),
          versionNumber: result.version.versionNumber,
          compat: packCompat(meta?.range, world?.context.format),
          otherVersion: result.otherVersion,
          added,
          needs: result.needs,
        };
      } finally {
        dataPackDownloads.delete(projectId);
      }
    },

    cancelDataPackInstall(projectId: string): boolean {
      const controller = dataPackDownloads.get(projectId);
      controller?.abort();
      return controller !== undefined;
    },

    async openWorldDataPacksFolder(worldId: string): Promise<void> {
      await ready;
      await dataPackWorld(worldId);
      await mkdir(paths.worldDataPacksDir(worldId), { recursive: true });
      await openFolder(paths.worldDataPacksDir(worldId));
    },

    // ---- Shader packs ----

    async shaderLibrary(): Promise<LibraryPack[]> {
      await ready;
      await sync();
      return shaders.list();
    },

    shaderIcon: (sha1: string) => shaders.icon(sha1),

    /** A profile's Shaders tab: the active shader, its shaders, the library's, and Iris. */
    async profileShaders(profileId: string): Promise<ProfileShaders> {
      const profile = await requireProfile(profileId);
      const busy = isBusy(profileId);
      if (!busy) await sync([profileId]);
      return profileShaders.view(profile, {
        running: busy,
        hasIris: profile.loader !== null && (await hasMod(profileId, "iris")),
      });
    },

    /**
     * Make a shader the profile's active one, or turn shaders off (`null`). Never
     * while a game of it runs or starts: Iris rewrites its config on start.
     */
    async setActiveShader(profileId: string, ref: unknown): Promise<void> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      let parsed: PackRef | null = null;
      if (ref !== null) {
        const result = shaderRefSchema.safeParse(ref);
        if (!result.success)
          throw new AppError("SHADER_NOT_FOUND", "That shader isn't valid.");
        parsed = result.data;
      }
      const chosen = parsed;
      await serialFs(() => profileShaders.setActive(profile, chosen));
      changed();
    },

    /** Put a library shader in a profile, or take it out (`present: false`). */
    async setShaderInProfile(
      profileId: string,
      sha1: string,
      present: boolean,
    ): Promise<void> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (typeof sha1 !== "string" || !/^[0-9a-f]{40}$/.test(sha1))
        throw new AppError("SHADER_NOT_FOUND", "That shader isn't valid.");
      await serialFs(() =>
        present
          ? profileShaders.add(profile, sha1)
          : profileShaders.remove(profile, sha1),
      );
      changed();
    },

    /**
     * Add shader zips to the library; with a profile, also put them there, and make
     * the last one active when the profile had none.
     */
    async addShaders(
      files: readonly unknown[],
      profileId?: string,
    ): Promise<AddPacksResult> {
      await ready;
      const profile = profileId ? await requireProfile(profileId) : undefined;
      const { result, stored, storedNames } = await addZips(
        shaders,
        files,
        "NOT_A_SHADER",
      );
      if (profile && stored.length > 0) {
        let code: string | undefined;
        if (isBusy(profile.id)) code = "GAME_RUNNING";
        else
          await serialFs(async () => {
            for (const sha1 of stored) await profileShaders.add(profile, sha1);
          }).catch((err: unknown) => {
            code = err instanceof AppError ? err.code : "INTERNAL";
          });
        if (code)
          for (const fileName of storedNames)
            result.failed.push({ fileName, code });
      }
      changed();
      return result;
    },

    /** Delete a shader from the library and every profile (`force` when profiles have it). */
    async removeShader(sha1: string, force: boolean): Promise<void> {
      await ready;
      const users = await shaders.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError("SHADER_IN_USE", "Profiles still use this shader.");
      for (const id of users) assertNotRunning(id);
      await serialFs(async () => {
        for (const id of users) {
          const profile = await profiles.get(id);
          if (profile) await profileShaders.remove(profile, sha1);
        }
        await shaders.remove(sha1);
      });
      changed();
    },

    async removeUnusedShaders(): Promise<number> {
      await ready;
      await sync();
      const count = await serialFs(() => shaders.removeUnused());
      changed();
      return count;
    },

    /** Shaders on the mod sites matching `query`, for the profile's Minecraft version if given. */
    async searchShaders(
      query: string,
      profileId: string | undefined,
      offset: number,
    ): Promise<PackSearchResult> {
      const profile = profileId ? await requireProfile(profileId) : undefined;
      return searchSite("shader", query, profile, offset);
    },

    /** Download a shader into the library; with a profile, make it the active one there. */
    async installShader(
      sourceId: string,
      projectId: string,
      profileId?: string,
    ): Promise<ShaderInstallResult> {
      await ready;
      const profile = profileId ? await requireProfile(profileId) : undefined;
      if (shaderDownloads.has(projectId))
        throw new AppError("BUSY", "This shader is already downloading.");
      const controller = new AbortController();
      shaderDownloads.set(projectId, controller);
      try {
        const result = await downloadPack(
          { downloader, library: shaders, source: sources.get(sourceId) },
          projectId,
          {
            ...(profile && { gameVersion: profile.gameVersion }),
            kind: SHADER_DOWNLOAD,
            signal: controller.signal,
            onProgress: (p) => {
              broadcast("shaders:download", {
                projectId,
                bytes: p.bytes,
                totalBytes: p.totalBytes,
              });
            },
          },
        );
        if (result.project?.iconUrl)
          await saveIcon(shaders, result.sha1, result.project.iconUrl);
        let activated = false;
        if (profile && profile.loader !== null && !isBusy(profile.id)) {
          activated = await serialFs(() =>
            profileShaders.setActive(profile, {
              kind: "library",
              sha1: result.sha1,
            }),
          ).then(
            () => true,
            () => false,
          );
        }
        const meta = await shaders.meta(result.sha1);
        changed();
        return {
          sha1: result.sha1,
          name: (meta?.fileName ?? result.version.file.fileName).replace(
            /\.zip$/i,
            "",
          ),
          versionNumber: result.version.versionNumber,
          otherVersion: result.otherVersion,
          irisTagged: result.version.loaders.includes("iris"),
          activated,
          irisMissing:
            profile !== undefined &&
            profile.loader !== null &&
            !(await hasMod(profile.id, "iris")),
        };
      } finally {
        shaderDownloads.delete(projectId);
      }
    },

    cancelShaderInstall(projectId: string): boolean {
      const controller = shaderDownloads.get(projectId);
      controller?.abort();
      return controller !== undefined;
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

    /**
     * Newer versions of a profile's enabled mods, from the sites they came from.
     * Kept for a few minutes, so Update uses exactly what was shown.
     */
    async checkModUpdates(profileId: string): Promise<ModUpdateCheck> {
      const profile = await requireProfile(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      const manifest = profile.modpack
        ? await readManifest(paths, profileId)
        : undefined;
      const { check, versions } = await findModUpdates({
        sources,
        enabled: await mods.enabledMods(profileId),
        target: {
          gameVersion: profile.gameVersion,
          loaders: acceptedLoaders(profile.loader.id),
        },
        packFiles: new Set(Object.values(manifest?.files ?? {})),
      });
      updateChecks.set(profileId, { at: Date.now(), versions });
      return check;
    },

    /** Update these enabled mods to the versions the last check found (checked again if old). */
    async applyModUpdates(
      profileId: string,
      sha1s: string[],
    ): Promise<ModUpdateResult> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      if (bulk) throw new AppError("MOD_BULK_BUSY", "A download is running.");
      let cached = updateChecks.get(profileId);
      if (!cached || Date.now() - cached.at > UPDATE_CHECK_TTL_MS) {
        await api.checkModUpdates(profileId);
        cached = updateChecks.get(profileId);
      }
      const enabled = await mods.enabledMods(profileId);
      const picks = enabled.flatMap((old) => {
        const version = sha1s.includes(old.sha1)
          ? cached?.versions.get(old.sha1)
          : undefined;
        return version ? [{ old, version }] : [];
      });
      const controller = new AbortController();
      bulk = controller;
      try {
        const result = await applyModUpdates(
          { downloader, paths, library: mods, sources },
          {
            profile,
            target: {
              gameVersion: profile.gameVersion,
              loaders: acceptedLoaders(profile.loader.id),
            },
            picks,
            serial: serialFs,
            signal: controller.signal,
            onProgress: (p) => {
              broadcast("mods:bulkProgress", p);
            },
          },
        );
        updateChecks.delete(profileId);
        reports.clear();
        return result;
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
        if (bytes && !(await pathExists(backup)))
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
      if (moving) throw new AppError("BUSY", "The data folder is being moved.");
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
          ...(target && { quickPlay: target.core }),
        });
        log.info(
          `launching profile ${profile.id} (${versionId}) as ${identity.username}${target ? ` into ${target.kind}` : ""}`,
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
          ...(target && { quickPlay: target.shared }),
        };
        running.set(game.launchId, game);
        startedAt.set(game.launchId, Date.now());
        saveRunning();
        handle.onLog((lines) => {
          broadcast("game:log", {
            launchId: game.launchId,
            profileId: profile.id,
            lines,
          });
        });
        handle.onExit(({ code, crashed }) => {
          gameExited(game, code, crashed);
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
     * Launcher work an app update must not cut off: installs, downloads, imports,
     * backups, a mod pack update or a data move. Running games don't count: they
     * run on their own and are found again after a restart.
     */
    isAnyBusy(): boolean {
      return (
        moving ||
        starting.size > 0 ||
        packUpdating.size > 0 ||
        queue.isAnyBusy() ||
        [...plans.values()].some((p) => p.controller) ||
        bulk !== undefined ||
        javaInstall !== undefined ||
        backupJob !== undefined ||
        backupsWaiting > 0 ||
        packDownloads.size > 0 ||
        shaderDownloads.size > 0 ||
        dataPackDownloads.size > 0 ||
        modpacks.isBusy()
      );
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

    // ---- Storage ----

    /** The data folder's size by part, and what each clean-up would free. */
    storageScan(): Promise<StorageReport> {
      return storage.scan();
    },

    /** Run the chosen clean-ups (each planned again first). */
    async storageClean(ids: unknown): Promise<CleanupResult> {
      await ready;
      if (moving) throw new AppError("BUSY", "The data folder is being moved.");
      try {
        return await storage.clean(ids);
      } finally {
        changed();
      }
    },
  };

  const storage = createStorageService({
    paths,
    platform,
    logger: log,
    libraries: [
      {
        list: async () =>
          (await api.modLibrary()).map((m) => ({
            name: m.name,
            file: paths.modStoreFile(m.sha1),
            usedBy: m.usedBy,
          })),
        removeUnused: () => api.removeUnusedMods(),
      },
      {
        list: () => api.packLibrary(),
        removeUnused: () => api.removeUnusedPacks(),
      },
      {
        list: () => api.shaderLibrary(),
        removeUnused: () => api.removeUnusedShaders(),
      },
      {
        list: () => api.dataPackLibrary(),
        removeUnused: () => api.removeUnusedDataPacks(),
      },
    ],
    installedVersions: () => api.installedVersions(),
    deleteVersion: (id) => api.deleteVersion(id, true),
    removeJava: (component) => api.removeJava(component),
    orphanBackupFolders: async () => {
      const keys: string[] = [];
      for (const folder of await listBackupFolders(paths))
        if (await isOrphanBackup(folder.key)) keys.push(folder.key);
      return keys;
    },
    profileIds: async () => (await profiles.list()).map((p) => p.id),
    isBusy,
    busy: () =>
      queue.isAnyBusy() ||
      javaInstall !== undefined ||
      backupJob !== undefined ||
      moving,
    serialFs,
    progress: (files) => {
      broadcast("storage:progress", { files });
    },
  });

  return api;
}

export type LauncherService = ReturnType<typeof createLauncherService>;
