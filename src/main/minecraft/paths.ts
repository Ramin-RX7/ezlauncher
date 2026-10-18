import { join } from "node:path";
import { AppError } from "../core/errors";

/**
 * Ids end up in file paths, and some come from the renderer: allow only safe names
 * (Mojang and mod loader ids use letters, digits, `.`, `_`, `-`, `+` and spaces).
 */
export function safeId(id: string): string {
  if (
    !/^[A-Za-z0-9._+ -]{1,128}$/.test(id) ||
    id === "." ||
    id === ".." ||
    id.includes("..")
  ) {
    throw new AppError("INVALID_ID", `Invalid name: ${id}`);
  }
  return id;
}

/**
 * A single folder name chosen by the game or the user (e.g. a world folder
 * `New World (1)`): any characters except path separators, characters Windows
 * forbids, control characters, and names that are only dots.
 */
export function safeFolderName(name: string): string {
  if (
    name.length === 0 ||
    name.length > 128 ||
    // eslint-disable-next-line no-control-regex
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    /^\.+$/.test(name) ||
    /[. ]$/.test(name)
  ) {
    throw new AppError("INVALID_ID", `Invalid name: ${name}`);
  }
  return name;
}

function sha1Name(hash: string): string {
  if (!/^[0-9a-f]{40}$/i.test(hash))
    throw new AppError("INVALID_ID", `Invalid hash: ${hash}`);
  return hash.toLowerCase();
}

/** Join a forward-slash relative path under `root`, refusing `..` and empty segments. */
export function safeJoin(root: string, relPath: string): string {
  const parts = relPath.split("/");
  if (parts.some((p) => p === ".." || p === "" || p.includes("\\"))) {
    throw new AppError("INVALID_ID", `Invalid path: ${relPath}`);
  }
  return join(root, ...parts);
}

/**
 * Every path under the data directory is built here and nowhere else.
 */
export function createPaths(dataDir: string) {
  const versions = join(dataDir, "versions");
  const libraries = join(dataDir, "libraries");
  const assets = join(dataDir, "assets");
  const runtimes = join(dataDir, "runtimes");
  const launcher = join(dataDir, "launcher");
  const profiles = join(dataDir, "profiles");
  const worlds = join(dataDir, "worlds");
  const modsStore = join(dataDir, "mods-store");
  const packsStore = join(dataDir, "resourcepacks-store");
  const shadersStore = join(dataDir, "shaderpacks-store");
  const dataPacksStore = join(dataDir, "datapacks-store");
  const backups = join(dataDir, "backups");

  return {
    dataDir,
    versionsDir: versions,
    librariesDir: libraries,
    assetsDir: assets,

    versionDir: (id: string) => join(versions, safeId(id)),
    versionJson: (id: string) => join(versions, safeId(id), `${id}.json`),
    clientJar: (id: string) => join(versions, safeId(id), `${id}.jar`),
    nativesDir: (id: string) => join(versions, safeId(id), "natives"),
    installMarker: (id: string) => join(versions, safeId(id), "install.json"),

    /** `relPath` uses forward slashes, as in version JSONs. */
    library: (relPath: string) => safeJoin(libraries, relPath),

    assetIndex: (indexId: string) =>
      join(assets, "indexes", `${safeId(indexId)}.json`),
    assetObject: (hash: string) => {
      const h = sha1Name(hash);
      return join(assets, "objects", h.slice(0, 2), h);
    },
    assetsVirtual: (indexId: string) =>
      join(assets, "virtual", safeId(indexId)),
    logConfig: (fileId: string) => join(assets, "log_configs", safeId(fileId)),

    runtimesDir: runtimes,
    runtimeDir: (component: string) => join(runtimes, safeId(component)),
    runtimeManifest: (component: string) =>
      join(runtimes, safeId(component), "manifest.json"),
    runtimeMarker: (component: string) =>
      join(runtimes, safeId(component), ".installed.json"),

    profilesDir: profiles,
    /** A profile's game folder (mods, config, options, saves…). Named by id, so renaming moves nothing. */
    gameDir: (profileId: string) => join(profiles, safeId(profileId)),
    modsDir: (profileId: string) => join(profiles, safeId(profileId), "mods"),
    savesDir: (profileId: string) => join(profiles, safeId(profileId), "saves"),
    resourcePacksDir: (profileId: string) =>
      join(profiles, safeId(profileId), "resourcepacks"),
    /** An unzipped pack folder in a profile's `resourcepacks/`. */
    folderPackDir: (profileId: string, name: string) =>
      join(profiles, safeId(profileId), "resourcepacks", safeFolderName(name)),
    /** The game's own settings file (only its resource pack lines are ever changed). */
    optionsFile: (profileId: string) =>
      join(profiles, safeId(profileId), "options.txt"),
    /** A copy of `options.txt` from before the launcher first changed it. */
    optionsBackup: (profileId: string) =>
      join(profiles, safeId(profileId), "options.txt.ezl-bak"),
    shaderPacksDir: (profileId: string) =>
      join(profiles, safeId(profileId), "shaderpacks"),
    /** An unzipped shader pack folder in a profile's `shaderpacks/`. */
    folderShaderDir: (profileId: string, name: string) =>
      join(profiles, safeId(profileId), "shaderpacks", safeFolderName(name)),
    /** Iris's options for one shader pack: `shaderpacks/<entry>.txt` (`Foo.zip.txt`). */
    shaderOptionsFile: (profileId: string, entry: string) =>
      join(
        profiles,
        safeId(profileId),
        "shaderpacks",
        safeFolderName(`${entry}.txt`),
      ),
    /** Iris's settings (only the active shader lines are ever changed). */
    irisConfigFile: (profileId: string) =>
      join(profiles, safeId(profileId), "config", "iris.properties"),
    /** A copy of `iris.properties` from before the launcher first changed it. */
    irisConfigBackup: (profileId: string) =>
      join(profiles, safeId(profileId), "config", "iris.properties.ezl-bak"),
    /** The game's multiplayer server list (only ever read). */
    serversFile: (profileId: string) =>
      join(profiles, safeId(profileId), "servers.dat"),
    /** A profile's `screenshots`: a directory link to `screenshotsDir`. */
    screenshotsLink: (profileId: string) =>
      join(profiles, safeId(profileId), "screenshots"),
    /** A world's link inside a profile's `saves/`. */
    saveLink: (profileId: string, worldId: string) =>
      join(profiles, safeId(profileId), "saves", safeFolderName(worldId)),

    /** Every profile's screenshots (each profile's `screenshots` links here). */
    screenshotsDir: join(dataDir, "screenshots"),
    /** Every world, whichever profile owns it. */
    worldsDir: worlds,
    /** World backups: `backups/<key>/<id>.zip` plus the folder's `index.json`. */
    backupsDir: backups,
    backupDir: (key: string) => join(backups, safeFolderName(key)),
    backupFile: (key: string, id: string) =>
      join(backups, safeFolderName(key), `${safeId(id)}.zip`),
    backupIndex: (key: string) =>
      join(backups, safeFolderName(key), "index.json"),
    worldDir: (worldId: string) => join(worlds, safeFolderName(worldId)),
    /** A world's data packs (the game reads them from here; each world has its own). */
    worldDataPacksDir: (worldId: string) =>
      join(worlds, safeFolderName(worldId), "datapacks"),
    /** An unzipped data pack folder in a world's `datapacks/`. */
    folderDataPackDir: (worldId: string, name: string) =>
      join(worlds, safeFolderName(worldId), "datapacks", safeFolderName(name)),
    worldLevelDat: (worldId: string) =>
      join(worlds, safeFolderName(worldId), "level.dat"),

    modsStoreDir: modsStore,
    modStoreFile: (sha1: string) => join(modsStore, `${sha1Name(sha1)}.jar`),
    modIcon: (sha1: string) =>
      join(modsStore, "icons", `${sha1Name(sha1)}.png`),

    resourcePacksStoreDir: packsStore,
    resourcePackStoreFile: (sha1: string) =>
      join(packsStore, `${sha1Name(sha1)}.zip`),
    resourcePackIcon: (sha1: string) =>
      join(packsStore, "icons", `${sha1Name(sha1)}.png`),

    dataPacksStoreDir: dataPacksStore,
    dataPackStoreFile: (sha1: string) =>
      join(dataPacksStore, `${sha1Name(sha1)}.zip`),
    dataPackIcon: (sha1: string) =>
      join(dataPacksStore, "icons", `${sha1Name(sha1)}.png`),

    shaderPacksStoreDir: shadersStore,
    shaderPackStoreFile: (sha1: string) =>
      join(shadersStore, `${sha1Name(sha1)}.zip`),
    shaderPackIcon: (sha1: string) =>
      join(shadersStore, "icons", `${sha1Name(sha1)}.png`),

    /** Scope 01–02 game folders (`games/<versionId>`); only read to migrate them into profiles. */
    legacyGamesDir: join(dataDir, "games"),
    /** Game folder of the Node-only dev CLI, which has no profiles. */
    devGameDir: (versionId: string) =>
      join(dataDir, "dev-games", safeId(versionId)),

    launcherFile: (name: string) => join(launcher, name),
    /** What a mod pack put into a profile (for updates): `launcher/modpacks/<id>.json`. */
    modpackManifest: (profileId: string) =>
      join(launcher, "modpacks", `${safeId(profileId)}.json`),
    /** A profile's own picture (a mod pack's icon). */
    profileIcon: (profileId: string) =>
      join(launcher, "profile-icons", `${safeId(profileId)}.png`),
    /** The icon a profile's desktop shortcut shows (`.ico` on Windows, `.png` on Linux). */
    shortcutIcon: (profileId: string, ext: "ico" | "png") =>
      join(launcher, "shortcut-icons", `${safeId(profileId)}.${ext}`),
    /** Mod pack files downloaded from a site, kept until imported. */
    modpackDownload: (sha1: string) =>
      join(launcher, "modpack-downloads", `${sha1Name(sha1)}.mrpack`),
    modpackDownloadsDir: join(launcher, "modpack-downloads"),
    /** A mod pack's new profile while it's imported; renamed to its game folder when done. */
    modpackImportDir: (profileId: string) =>
      join(profiles, `.import-${safeId(profileId)}`),
    /** A pack update's new files, unpacked next to the profile until applied. */
    modpackStagingDir: (profileId: string, token: string) =>
      join(profiles, `.update-${safeId(profileId)}-${safeId(token)}`),
    /** The files a pack update replaced or removed, zipped before it ran. */
    modpackBackupsDir: (profileId: string) =>
      join(dataDir, "modpack-backups", safeId(profileId)),
    modpackBackupFile: (profileId: string, stamp: string) =>
      join(
        dataDir,
        "modpack-backups",
        safeId(profileId),
        `${safeId(stamp)}.zip`,
      ),
    /** A cached patch-notes entry (by its id in Mojang's feed). */
    patchNotesEntry: (entryId: string) =>
      join(launcher, "patch-notes", `${safeId(entryId)}.json`),
    /** Cached list of the Minecraft versions a mod loader supports. */
    loaderCache: (loaderId: string) =>
      join(launcher, "loaders", `${safeId(loaderId)}.json`),
  };
}

export type Paths = ReturnType<typeof createPaths>;
