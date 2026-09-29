import { rm, stat } from "node:fs/promises";
import { AppError } from "../core/errors";
import type { DownloadProgress, Downloader } from "../minecraft/downloader";
import type { FileTask } from "../minecraft/fileTask";
import type { Paths } from "../minecraft/paths";
import type { ModLibrary } from "../profiles/mods";
import type { InstallPlan } from "./resolveDependencies";
import type { ModSource, RemoteVersion } from "./types";

export interface DownloadModsDeps {
  downloader: Downloader;
  paths: Paths;
  library: ModLibrary;
  source: ModSource;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download the given versions straight into the store (checked against their SHA1),
 * then record them in the library with where they came from. A cancelled or failed
 * batch leaves nothing half-added: files it stored are removed again.
 * Enabling into a profile is a separate step, so this can also just fill the store.
 */
export async function storeVersions(
  { downloader, paths, library, source }: DownloadModsDeps,
  versions: readonly RemoteVersion[],
  {
    signal,
    onProgress,
    addedAs,
  }: {
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
    /** How each file enters the library (the user's own mod, or a dependency). */
    addedAs?: (v: RemoteVersion) => "user" | "dependency";
  } = {},
): Promise<void> {
  const tasks: FileTask[] = [];
  for (const v of versions) {
    const dest = paths.modStoreFile(v.file.sha1);
    if (await exists(dest)) continue;
    if (tasks.some((t) => t.dest === dest)) continue;
    tasks.push({ dest, url: v.file.url, sha1: v.file.sha1, size: v.file.size });
  }

  try {
    await downloader.run(tasks, {
      ...(signal && { signal }),
      ...(onProgress && { onProgress }),
    });
    if (signal?.aborted) throw new AppError("CANCELLED", "Download cancelled.");
    await library.addStored(
      versions.map((v) => ({
        sha1: v.file.sha1,
        fileName: v.file.fileName,
        source: {
          sourceId: v.sourceId,
          projectId: v.projectId,
          versionId: v.versionId,
          pageUrl: source.pageUrl(v.projectId),
          loaders: v.loaders,
          gameVersions: v.gameVersions,
        },
        ...(addedAs && { addedAs: addedAs(v) }),
      })),
    );
  } catch (err) {
    // Take back what this batch stored, unless the library already knew it.
    for (const task of tasks) {
      const sha1 = task.sha1 ?? "";
      if (!(await library.meta(sha1))) await rm(task.dest, { force: true });
    }
    throw err;
  }
}

/**
 * Download a plan's files straight into the store (checked against their SHA1),
 * then add them to the library and enable everything in the profile.
 * Resolves to the enabled mods that were replaced by another version of themselves.
 * A cancelled or failed batch leaves nothing half-added: files it stored are removed.
 */
export async function downloadPlan(
  deps: DownloadModsDeps,
  plan: InstallPlan,
  profileId: string,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<{ replaced: string[] }> {
  if (plan.missing.length > 0) {
    throw new AppError(
      "MOD_DEPENDENCY_MISSING",
      "A required mod has no version for this profile.",
    );
  }
  const downloads = plan.items.flatMap((i) =>
    i.action === "download" ? [i.version] : [],
  );
  const roots = new Set(
    plan.items.flatMap((i) =>
      i.action === "download" && i.root ? [i.version.file.sha1] : [],
    ),
  );

  await storeVersions(deps, downloads, {
    ...(signal && { signal }),
    ...(onProgress && { onProgress }),
    // The mod asked for is the user's; what it pulled in is a dependency.
    addedAs: (v) => (roots.has(v.file.sha1) ? "user" : "dependency"),
  });

  const replaced = await deps.library.enableAll(
    profileId,
    plan.items.map((item) =>
      item.action === "download" ? item.version.file.sha1 : item.sha1,
    ),
  );
  return { replaced: replaced.map((m) => m.name) };
}
