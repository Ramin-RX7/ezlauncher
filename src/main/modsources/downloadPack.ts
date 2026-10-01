import { rm } from "node:fs/promises";
import type { PackNeed } from "@shared/launcher";
import { AppError } from "../core/errors";
import type { DownloadProgress, Downloader } from "../minecraft/downloader";
import type { Paths } from "../minecraft/paths";
import { exists } from "../profiles/linkedStore";
import type { PackLibrary } from "../profiles/packs/library";
import type { ModSource, RemoteVersion } from "./types";

/*
 * Download a resource pack from a site into the pack library. Packs have no
 * dependencies to resolve: the newest version for the Minecraft version is taken
 * (else the newest at all, since packs are tagged loosely and the pack's own
 * pack.mcmeta decides), and what it says it needs is only reported.
 */

export interface DownloadPackDeps {
  downloader: Downloader;
  paths: Paths;
  library: PackLibrary;
  source: ModSource;
}

const PACK_TARGET = {
  loaders: ["minecraft"],
  projectType: "resourcepack" as const,
};

export async function downloadPack(
  { downloader, paths, library, source }: DownloadPackDeps,
  projectId: string,
  {
    gameVersion,
    signal,
    onProgress,
  }: {
    /** The profile's Minecraft version; missing = any. */
    gameVersion?: string;
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
  } = {},
): Promise<{
  sha1: string;
  version: RemoteVersion;
  otherVersion: boolean;
  needs: PackNeed[];
}> {
  let version = await source.getCompatibleVersion(
    projectId,
    { ...PACK_TARGET, gameVersion: gameVersion ?? "" },
    signal,
  );
  let otherVersion = false;
  if (!version && gameVersion) {
    version = await source.getCompatibleVersion(
      projectId,
      { ...PACK_TARGET, gameVersion: "" },
      signal,
    );
    otherVersion = version !== null;
  }
  if (!version)
    throw new AppError(
      "PACK_NO_VERSION",
      "This pack has no version to download.",
    );
  if (!/\.zip$/i.test(version.file.fileName))
    throw new AppError("NOT_A_PACK", `${version.file.fileName} isn't a zip.`);

  const { sha1, url, size, fileName } = version.file;
  const dest = paths.resourcePackStoreFile(sha1);
  const known = (await library.meta(sha1)) !== undefined;
  try {
    if (!(await exists(dest)))
      await downloader.run([{ dest, url, sha1, size }], {
        ...(signal && { signal }),
        ...(onProgress && { onProgress }),
      });
    if (signal?.aborted) throw new AppError("CANCELLED", "Download cancelled.");
    const project = (await source.getProjects([projectId], signal))[0];
    await library.addStored([
      {
        sha1,
        fileName,
        source: {
          sourceId: version.sourceId,
          projectId,
          versionId: version.versionId,
          pageUrl:
            project?.pageUrl ?? source.pageUrl(projectId, "resourcepack"),
        },
      },
    ]);
  } catch (err) {
    // Take back a file this download stored, unless the library already had it.
    if (!known) await rm(dest, { force: true });
    throw err;
  }
  return {
    sha1,
    version,
    otherVersion,
    needs: await needsOf(source, version, signal),
  };
}

/** What the version requires; if it lists nothing, what the project as a whole needs. */
async function needsOf(
  source: ModSource,
  version: RemoteVersion,
  signal?: AbortSignal,
): Promise<PackNeed[]> {
  try {
    const required = version.dependencies
      .filter((d) => d.kind === "required" && d.projectId)
      .map((d) => d.projectId ?? "");
    const projects =
      required.length > 0
        ? await source.getProjects(required, signal)
        : await source.projectDependencies(version.projectId, signal);
    return projects.map((p) => ({
      name: p.name,
      slug: p.slug,
      projectType: p.projectType ?? "mod",
      pageUrl: p.pageUrl,
    }));
  } catch {
    return []; // only a hint: never fail the download over it
  }
}
