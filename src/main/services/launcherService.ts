import { mkdir } from "node:fs/promises";
import { app, BrowserWindow, net, shell } from "electron";
import type {
  AccountInfo,
  CleanupResult,
  PackSearchResult,
  Profile,
  StorageReport,
} from "@shared/launcher";
import { createAccountStore } from "../auth/accountStore";
import { createAccounts } from "../auth/accounts";
import { OFFLINE_PROVIDER_ID } from "../auth/providers/offline";
import { getProvider } from "../auth/registry";
import type { Account } from "../auth/types";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { broadcast } from "../ipc/register";
import { createDownloader } from "../minecraft/downloader";
import { launchGame } from "../minecraft/gameProcess";
import { installVersion } from "../minecraft/installer";
import { InstallQueue } from "../minecraft/installQueue";
import {
  installLoader,
  prepareLoader,
} from "../minecraft/loaders/installLoader";
import { createLoaderRegistry } from "../minecraft/loaders/registry";
import { getManifest } from "../minecraft/manifest";
import { createPaths } from "../minecraft/paths";
import { createPatchNotes } from "../minecraft/patchNotes";
import { detectPlatform } from "../minecraft/platform";
import { createModSourceRegistry } from "../modsources/registry";
import { listBackupFolders } from "../profiles/backups";
import { migrateLegacyGames } from "../profiles/migrate";
import { createModLibrary } from "../profiles/mods";
import {
  createPackLibrary,
  dataPackKind,
  shaderPackKind,
} from "../profiles/packs/library";
import { readGameFormat, type GameFormat } from "../profiles/packs/packFormat";
import { createProfilePacks } from "../profiles/packs/profilePacks";
import { createProfileShaders } from "../profiles/packs/profileShaders";
import { createWorldDataPacks } from "../profiles/packs/worldDataPacks";
import { createPlayTime } from "../profiles/playTime";
import { createProfileStore } from "../profiles/profiles";
import { createSettingsStore } from "../settings/settings";
import { createProfileShortcut } from "../shortcuts";
import { createBackupService } from "./backups";
import { createDataPackService } from "./dataPacks";
import { createDiagnostics } from "./diagnostics";
import { createGameService } from "./games";
import { createJavaService } from "./java";
import { createModpackService } from "./modpacks";
import { createModService } from "./mods";
import { searchSite } from "./packs";
import { createProfileService } from "./profiles";
import { createResourcePackService } from "./resourcePacks";
import { createRuntime } from "./runtime";
import { createShaderService } from "./shaders";
import { createStorageService } from "./storage";
import { createSync } from "./sync";
import { createVersionService } from "./versions";

/**
 * The composition root for one data folder: wires the Electron-free core
 * (downloads, installs, profiles, worlds, launches) to Electron (network, windows, IPC events).
 */
export function createLauncherService(dataDir: string, logger: Logger) {
  // ---- The core: stores and libraries of this data folder ----

  const log = logger.child("launcher");
  const paths = createPaths(dataDir);
  const platform = detectPlatform();
  const downloader = createDownloader({
    // Electron's fetch uses the system proxy settings.
    fetch: (url, init) => net.fetch(url, init),
    userAgent: `ezlauncher/${app.getVersion()}`,
    logger: logger.child("download"),
  });
  const loaders = createLoaderRegistry({ downloader });
  const settings = createSettingsStore(paths.launcherFile("settings.json"));
  const accounts = createAccounts({
    store: createAccountStore(paths.launcherFile("accounts.json")),
    provider: getProvider(OFFLINE_PROVIDER_ID),
    getProvider,
  });
  const runtime = createRuntime();
  const { running, starting, packUpdating, serialFs, isBusy } = runtime;
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
  const queue = new InstallQueue((event) => {
    broadcast("install:state", event);
  });
  const playTime = createPlayTime(paths.launcherFile("playtime.json"), {
    logger: log,
  });
  const changed = (): void => {
    broadcast("profiles:changed", {});
  };
  /** Mojang's versions from the cached manifest (no download). */
  const manifestVersions = async () =>
    (await getManifest({ paths, downloader })).cached?.manifest.versions;

  // ---- Sync: worlds, screenshots, mods and packs ----

  const { sync, worldOptions } = createSync({
    paths,
    profiles,
    mods,
    packs,
    shaders,
    dataPacks,
    profilePacks,
    profileShaders,
    runtime,
    onAdopted: () => {
      modService.scheduleIdentify();
    },
    logger: log,
  });

  // ---- Helpers the services share ----

  /** Take a profile out of the mod, resource pack and shader libraries (its links). */
  async function forgetInLibraries(profileId: string): Promise<void> {
    await mods.forgetProfile(profileId);
    await packs.forgetProfile(profileId);
    await shaders.forgetProfile(profileId);
  }

  async function fetchImage(url: string): Promise<Uint8Array | undefined> {
    const res = await net.fetch(url);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
  }

  function toInfo(a: Account): AccountInfo {
    return { id: a.id, username: a.username, uuid: a.uuid };
  }

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

  // ---- Feature services (Electron-free; Electron comes in as callbacks) ----

  const packDeps = {
    paths,
    downloader,
    sources,
    profiles,
    runtime,
    whenReady: () => ready,
    requireProfile,
    sync,
    changed,
    fetchImage,
    logger: log,
  };
  const modService = createModService({
    paths,
    downloader,
    sources,
    mods,
    runtime,
    whenReady: () => ready,
    requireProfile,
    sync,
    changed,
    manifestVersions,
    // Packs added by hand are asked about with the mods, in one go.
    identifyPacks: async () => {
      const packsAsked = await resourcePackService.service.identify();
      const shadersAsked = await shaderService.service.identify();
      const dataPacksAsked = await dataPackService.service.identify();
      return packsAsked || shadersAsked || dataPacksAsked;
    },
    downloadProgress: (p) => {
      broadcast("mods:download", p);
    },
    bulkProgress: (p) => {
      broadcast("mods:bulkProgress", p);
    },
    logger: log,
  });
  const resourcePackService = createResourcePackService({
    ...packDeps,
    library: packs,
    profilePacks,
    gameFormat,
    progress: (p) => {
      broadcast("resourcePacks:download", p);
    },
  });
  const shaderService = createShaderService({
    ...packDeps,
    library: shaders,
    profileShaders,
    hasMod: (profileId, modId) => modService.hasMod(profileId, modId),
    progress: (p) => {
      broadcast("shaders:download", p);
    },
  });
  const dataPackService = createDataPackService({
    ...packDeps,
    library: dataPacks,
    worldDataPacks,
    gameFormat,
    openFolder,
    progress: (p) => {
      broadcast("dataPacks:download", p);
    },
  });

  const backups = createBackupService({
    paths,
    settings,
    runtime,
    whenReady: () => ready,
    requireProfile,
    sync,
    changed,
    openFolder,
    showItemInFolder: (file) => {
      shell.showItemInFolder(file);
    },
    state: (e) => {
      broadcast("backup:state", e);
    },
    progress: (p) => {
      broadcast("backup:progress", p);
    },
    logger: log,
  });
  const java = createJavaService({
    paths,
    downloader,
    platform,
    queue,
    runtime,
    whenReady: () => ready,
    progress: (p) => {
      broadcast("java:progress", p);
    },
  });

  const versions = createVersionService({
    paths,
    downloader,
    platform,
    loaders,
    queue,
    patchNotes,
    profiles,
    runtime,
    whenReady: () => ready,
    afterJava: () => java.afterJava(),
    install: { version: installVersion, loader: installLoader, prepareLoader },
    progress: (p) => {
      broadcast("install:progress", p);
    },
    changed,
    logger: log,
  });

  const modpacks = createModpackService({
    paths,
    downloader,
    profiles,
    sources,
    requireProfile,
    runtime,
    sync,
    forgetProfile: (id) => serialFs(() => forgetInLibraries(id)),
    loaderVersionOf: (profile) => versions.loaderVersionOf(profile),
    fetchImage,
    progress: (p) => {
      broadcast("modpacks:progress", p);
    },
    changed,
    logger: log,
  });

  const games = createGameService({
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
    ensureProfileInstall: (profile) => versions.ensureProfileInstall(profile),
    checkProfileMods: (profile) => modService.checkProfileMods(profile),
    autoBackup: (profileId, moment) => backups.autoBackup(profileId, moment),
    manifestVersions,
    launchGame,
    launcherVersion: app.getVersion(),
    applyOnGameStart,
    started: (game) => {
      broadcast("game:started", game);
    },
    gameLog: (e) => {
      broadcast("game:log", e);
    },
    exited: (e) => {
      broadcast("game:exit", e);
    },
    logger: log,
  });

  const profileService = createProfileService({
    paths,
    profiles,
    mods,
    dataPacks,
    profilePacks,
    profileShaders,
    modpacks,
    playTime,
    settings,
    runtime,
    whenReady: () => ready,
    requireProfile,
    sync,
    changed,
    validateLoader: (loader) => {
      versions.validateLoader(loader);
    },
    worldOptions,
    worldsWithBackups: (profileId) => backups.worldsWithBackups(profileId),
    forgetInLibraries,
    openFolder,
    createShortcut: createProfileShortcut,
    logger: log,
  });

  const diagnostics = createDiagnostics({
    paths,
    settings,
    accounts,
    profiles,
    mods,
    playTime,
    listJava: () => java.api.listJava(),
    validateMods: (profileId) => modService.api.validateMods(profileId),
    isBusy,
  });

  // ---- Startup ----

  // Old per-version game folders become profiles, then every profile's worlds are synced.
  const ready: Promise<void> = (async () => {
    try {
      await games.restore();
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
    await backups.pruneAll().catch((err: unknown) => {
      log.warn("pruning backups failed", err);
    });
    changed();
    modService.scheduleIdentify(0); // mods added while offline
  })();

  async function requireProfile(id: string): Promise<Profile> {
    await ready;
    const profile = await profiles.get(id);
    if (!profile) throw new AppError("PROFILE_NOT_FOUND", "Profile not found.");
    return profile;
  }

  const api = {
    paths,

    // ---- Versions ----

    ...versions.api,

    // ---- Profiles and worlds ----

    ...profileService.api,

    // ---- Mod packs ----

    modpacks,

    /** Mod packs on the first mod site, 20 at a time (every loader; the UI marks unsupported ones). */
    searchModpacks(query: unknown, offset: number): Promise<PackSearchResult> {
      return searchSite(sources, "modpack", query, undefined, offset);
    },

    // ---- Diagnostics ----

    diagnostics: (profileId?: string) => diagnostics.collect(profileId),

    // ---- World backups ----

    ...backups.api,

    // ---- Mods and packs ----

    ...modService.api,
    ...resourcePackService.api,
    ...dataPackService.api,
    ...shaderService.api,

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
        void backups.pruneAll();
      return next;
    },

    // ---- Games ----

    ...games.api,

    // ---- Java runtimes (Settings) ----

    ...java.api,

    // ---- App updates ----

    /**
     * Launcher work an app update must not cut off: installs, downloads, imports,
     * backups, a mod pack update or a data move. Running games don't count: they
     * run on their own and are found again after a restart.
     *
     * Three checks list background work, each for its own purpose: this one (all of
     * it), `prepareToMove` (work that writes into the data folder) and the storage
     * clean-up's `busy` (work that needs the game files or backups it may delete). A
     * new service with background work goes into each one that applies.
     */
    isAnyBusy(): boolean {
      return (
        runtime.moving ||
        starting.size > 0 ||
        packUpdating.size > 0 ||
        queue.isAnyBusy() ||
        modService.isBusy() ||
        java.isBusy() ||
        backups.isBusy() ||
        resourcePackService.service.isBusy() ||
        shaderService.service.isBusy() ||
        dataPackService.service.isBusy() ||
        modpacks.isBusy()
      );
    },

    // ---- Moving the data folder ----

    /**
     * Stop background work so the folder can be moved. Refuses while games run or
     * installs and mod downloads are busy.
     */
    prepareToMove(): void {
      if (running.size > 0 || starting.size > 0)
        throw new AppError("GAME_RUNNING", "Close the game first.");
      if (
        queue.isAnyBusy() ||
        modService.isBusy() ||
        java.isBusy() ||
        backups.isBusy()
      )
        throw new AppError(
          "BUSY",
          "Wait for installs and downloads to finish.",
        );
      runtime.moving = true;
      modService.stopIdentify();
    },

    /** The move failed or was cancelled: back to normal on the old folder. */
    resumeAfterMove(): void {
      runtime.moving = false;
    },

    // ---- Storage ----

    /** The data folder's size by part, and what each clean-up would free. */
    storageScan(): Promise<StorageReport> {
      return storage.scan();
    },

    /** Run the chosen clean-ups (each planned again first). */
    async storageClean(ids: unknown): Promise<CleanupResult> {
      await ready;
      if (runtime.moving)
        throw new AppError("BUSY", "The data folder is being moved.");
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
        if (await backups.isOrphanBackup(folder.key)) keys.push(folder.key);
      return keys;
    },
    profileIds: async () => (await profiles.list()).map((p) => p.id),
    isBusy,
    busy: () =>
      queue.isAnyBusy() || java.isBusy() || backups.hasJob() || runtime.moving,
    serialFs,
    progress: (files) => {
      broadcast("storage:progress", { files });
    },
  });

  return api;
}

export type LauncherService = ReturnType<typeof createLauncherService>;
