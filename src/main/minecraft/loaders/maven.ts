import { AppError } from "../../core/errors";
import type { Downloader } from "../downloader";
import { coordinateToPath, parseCoordinate } from "../maven";
import type { Library, VersionJson } from "../schemas";

/** Download URL of a Maven library from its repository, or undefined for a bad coordinate. */
export function mavenArtifactUrl(
  repoUrl: string,
  name: string,
): string | undefined {
  const coordinate = parseCoordinate(name);
  if (!coordinate) return undefined;
  const base = repoUrl.endsWith("/") ? repoUrl : `${repoUrl}/`;
  return base + coordinateToPath(coordinate);
}

/**
 * The published `<jar>.sha1` for a Maven artifact.
 * Undefined when the repository has none (404); other failures (offline) are thrown.
 */
export async function fetchMavenSha1(
  downloader: Downloader,
  jarUrl: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const text = await downloader.fetchText(
      `${jarUrl}.sha1`,
      signal ? { signal } : {},
    );
    const hash = /^[0-9a-f]{40}/i.exec(text.trim())?.[0];
    return hash?.toLowerCase();
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") return undefined;
    throw err;
  }
}

function needsHash(lib: Library): lib is Library & { url: string } {
  return !!lib.url && !lib.sha1 && !lib.downloads;
}

/**
 * Loader libraries given only as Maven coordinates without a hash (Quilt):
 * look up each `.sha1` and add it, so the download is verified.
 * Returns the new version JSON and the libraries left without a hash.
 */
export async function addMissingHashes(
  json: VersionJson,
  downloader: Downloader,
  signal?: AbortSignal,
): Promise<{ json: VersionJson; unverified: string[] }> {
  const unverified: string[] = [];
  const libraries = await Promise.all(
    (json.libraries ?? []).map(async (lib) => {
      if (!needsHash(lib)) return lib;
      const url = mavenArtifactUrl(lib.url, lib.name);
      const sha1 = url && (await fetchMavenSha1(downloader, url, signal));
      if (!sha1) {
        unverified.push(lib.name);
        return lib;
      }
      return { ...lib, sha1 };
    }),
  );
  return {
    json: json.libraries ? { ...json, libraries } : json,
    unverified: unverified.sort(),
  };
}
