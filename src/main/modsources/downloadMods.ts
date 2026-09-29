import { rm, stat } from "node:fs/promises";
import { AppError } from "../core/errors";
import type { DownloadProgress, Downloader } from "../minecraft/downloader";
import type { FileTask } from "../minecraft/fileTask";
import type { Paths } from "../minecraft/paths";
import type { ModLibrary } from "../profiles/mods";
import type { InstallPlan } from "./resolveDependencies";
import type { ModSource } from "./types";

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
 * Download a plan's files straight into the store (checked against their SHA1),
 * then add them to the library and enable everything in the profile.
 * Resolves to the enabled mods that were replaced by another version of themselves.
 * A cancelled or failed batch leaves nothing half-added: files it stored are removed.
 */
export async function downloadPlan(
  { downloader, paths, library, source }: DownloadModsDeps,
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

  const tasks: FileTask[] = [];
  for (const v of downloads) {
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
      downloads.map((v) => ({
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

  const replaced = await library.enableAll(
    profileId,
    plan.items.map((item) =>
      item.action === "download" ? item.version.file.sha1 : item.sha1,
    ),
  );
  return { replaced: replaced.map((m) => m.name) };
}
