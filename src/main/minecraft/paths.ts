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
 * Later scopes (profiles) change `gameDir` in this one place.
 */
export function createPaths(dataDir: string) {
  const versions = join(dataDir, "versions");
  const libraries = join(dataDir, "libraries");
  const assets = join(dataDir, "assets");
  const runtimes = join(dataDir, "runtimes");
  const launcher = join(dataDir, "launcher");

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
      if (!/^[0-9a-f]{40}$/i.test(hash))
        throw new AppError("INVALID_ID", `Invalid hash: ${hash}`);
      return join(assets, "objects", hash.slice(0, 2), hash);
    },
    assetsVirtual: (indexId: string) =>
      join(assets, "virtual", safeId(indexId)),
    logConfig: (fileId: string) => join(assets, "log_configs", safeId(fileId)),

    runtimeDir: (component: string) => join(runtimes, safeId(component)),
    runtimeManifest: (component: string) =>
      join(runtimes, safeId(component), "manifest.json"),
    runtimeMarker: (component: string) =>
      join(runtimes, safeId(component), ".installed.json"),

    /** The game's working folder (worlds, options, logs) for a version. */
    gameDir: (versionId: string) => join(dataDir, "games", safeId(versionId)),
    /** The mods folder inside a version's game folder. */
    modsDir: (versionId: string) =>
      join(dataDir, "games", safeId(versionId), "mods"),

    launcherFile: (name: string) => join(launcher, name),
    /** Cached list of the Minecraft versions a mod loader supports. */
    loaderCache: (loaderId: string) =>
      join(launcher, "loaders", `${safeId(loaderId)}.json`),
  };
}

export type Paths = ReturnType<typeof createPaths>;
