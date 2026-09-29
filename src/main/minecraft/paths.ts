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
    /** A world's link inside a profile's `saves/`. */
    saveLink: (profileId: string, worldId: string) =>
      join(profiles, safeId(profileId), "saves", safeFolderName(worldId)),

    /** Every world, whichever profile owns it. */
    worldsDir: worlds,
    worldDir: (worldId: string) => join(worlds, safeFolderName(worldId)),

    modsStoreDir: modsStore,
    modStoreFile: (sha1: string) => join(modsStore, `${sha1Name(sha1)}.jar`),
    modIcon: (sha1: string) =>
      join(modsStore, "icons", `${sha1Name(sha1)}.png`),

    /** Scope 01–02 game folders (`games/<versionId>`); only read to migrate them into profiles. */
    legacyGamesDir: join(dataDir, "games"),
    /** Game folder of the Node-only dev CLI, which has no profiles. */
    devGameDir: (versionId: string) =>
      join(dataDir, "dev-games", safeId(versionId)),

    launcherFile: (name: string) => join(launcher, name),
    /** Cached list of the Minecraft versions a mod loader supports. */
    loaderCache: (loaderId: string) =>
      join(launcher, "loaders", `${safeId(loaderId)}.json`),
  };
}

export type Paths = ReturnType<typeof createPaths>;
