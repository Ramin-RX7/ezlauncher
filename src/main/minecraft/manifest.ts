import { readdir } from "node:fs/promises";
import type { VersionListResult, VersionSummary } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Downloader } from "./downloader";
import type { Paths } from "./paths";
import {
  cachedManifestSchema,
  installMarkerSchema,
  versionJsonSchema,
  versionManifestSchema,
  type ManifestEntry,
  type VersionManifest,
} from "./schemas";

export const MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const CACHE_FILE = "version_manifest.json";

interface Deps {
  paths: Paths;
  downloader: Downloader;
}

interface CachedManifest {
  fetchedAt: string;
  manifest: VersionManifest;
}

async function readCache(paths: Paths): Promise<CachedManifest | undefined> {
  try {
    return await readJson(paths.launcherFile(CACHE_FILE), cachedManifestSchema);
  } catch {
    return undefined; // a broken cache is treated like no cache
  }
}

async function fetchAndCache({
  paths,
  downloader,
}: Deps): Promise<CachedManifest> {
  const text = await downloader.fetchText(MANIFEST_URL);
  const manifest = versionManifestSchema.parse(JSON.parse(text));
  const cached = { fetchedAt: new Date().toISOString(), manifest };
  await writeJsonAtomic(paths.launcherFile(CACHE_FILE), {
    schema: 1,
    ...cached,
  });
  return cached;
}

/**
 * The version manifest. Uses the saved copy when there is one (no network);
 * fetches from Mojang only when there's no copy yet, or when `refresh` is asked for.
 */
export async function getManifest(
  deps: Deps,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<{
  cached?: CachedManifest;
  source: VersionListResult["source"];
  refreshError?: string;
}> {
  const cached = await readCache(deps.paths);
  if (cached && !refresh) return { cached, source: "cache" };
  try {
    return { cached: await fetchAndCache(deps), source: "online" };
  } catch (err) {
    const code = err instanceof AppError ? err.code : "DOWNLOAD_FAILED";
    if (cached) return { cached, source: "cache", refreshError: code };
    return { source: "none", refreshError: code };
  }
}

/** Find a version in the manifest, fetching it once if the saved copy doesn't list it yet. */
export async function findManifestEntry(
  deps: Deps,
  id: string,
): Promise<ManifestEntry> {
  let { cached } = await getManifest(deps);
  let entry = cached?.manifest.versions.find((v) => v.id === id);
  if (!entry) {
    ({ cached } = await getManifest(deps, { refresh: true }));
    entry = cached?.manifest.versions.find((v) => v.id === id);
  }
  if (!entry)
    throw new AppError("VERSION_UNKNOWN", `Version ${id} was not found.`);
  return entry;
}

/** Versions with an install marker, read from disk only. */
export async function listInstalledVersions(
  paths: Paths,
): Promise<VersionSummary[]> {
  let dirs: string[];
  try {
    dirs = await readdir(paths.versionsDir);
  } catch {
    return [];
  }
  const result: VersionSummary[] = [];
  for (const id of dirs) {
    try {
      const marker = await readJson(
        paths.installMarker(id),
        installMarkerSchema,
      );
      if (!marker) continue;
      const json = await readJson(paths.versionJson(id), versionJsonSchema);
      result.push({
        id,
        type: json?.type ?? "release",
        releaseTime: json?.releaseTime ?? marker.installedAt,
        installed: true,
        ...(marker.loader && { loader: marker.loader }),
      });
    } catch {
      // unreadable version folder: not installed
    }
  }
  // Loader installs sort and filter like the version they run on.
  const byId = new Map(result.map((v) => [v.id, v]));
  return result.map((v) => {
    const parent = v.loader && byId.get(v.loader.gameVersion);
    return parent
      ? { ...v, type: parent.type, releaseTime: parent.releaseTime }
      : v;
  });
}

/** Newest first; a version comes before the loader installs built on it. */
export function compareVersionSummaries(
  a: VersionSummary,
  b: VersionSummary,
): number {
  const byTime = Date.parse(b.releaseTime) - Date.parse(a.releaseTime);
  if (byTime !== 0) return byTime;
  const gameA = a.loader?.gameVersion ?? a.id;
  const gameB = b.loader?.gameVersion ?? b.id;
  if (gameA !== gameB) return gameA < gameB ? -1 : 1;
  if (!a.loader !== !b.loader) return a.loader ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The list shown in the UI: the manifest plus installed versions (which appear even offline). */
export async function getVersionList(
  deps: Deps,
  options: { refresh?: boolean } = {},
): Promise<VersionListResult> {
  const [{ cached, source, refreshError }, installed] = await Promise.all([
    getManifest(deps, options),
    listInstalledVersions(deps.paths),
  ]);
  const installedIds = new Set(installed.map((v) => v.id));

  const byId = new Map<string, VersionSummary>();
  for (const v of cached?.manifest.versions ?? []) {
    byId.set(v.id, {
      id: v.id,
      type: v.type,
      releaseTime: v.releaseTime,
      installed: installedIds.has(v.id),
    });
  }
  for (const v of installed) {
    if (byId.has(v.id)) continue;
    const parent = v.loader && byId.get(v.loader.gameVersion);
    byId.set(
      v.id,
      parent ? { ...v, type: parent.type, releaseTime: parent.releaseTime } : v,
    );
  }

  const versions = [...byId.values()].sort(compareVersionSummaries);
  return {
    versions,
    source,
    ...(cached && {
      latest: cached.manifest.latest,
      fetchedAt: cached.fetchedAt,
    }),
    ...(refreshError && { refreshError }),
  };
}
