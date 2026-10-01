import { rm } from "node:fs/promises";
import type { PackNeed } from "@shared/launcher";
import { AppError } from "../core/errors";
import type { DownloadProgress, Downloader } from "../minecraft/downloader";
import { exists } from "../profiles/linkedStore";
import type { PackLibrary } from "../profiles/packs/library";
import type {
  ModSource,
  ProjectType,
  RemoteProject,
  RemoteVersion,
} from "./types";

/*
 * Download a pack (resource pack or shader pack) from a site into its library.
 * Packs have no dependencies to resolve: the newest version for the Minecraft
 * version is taken (else the newest at all, since packs are tagged loosely), and
 * what it says it needs is only reported.
 */

export interface DownloadPackDeps {
  downloader: Downloader;
  library: PackLibrary;
  source: ModSource;
}

/** How one kind of pack is found on a site. */
export interface PackDownloadKind {
  projectType: ProjectType;
  /** Loader sets to try, best first (for each Minecraft version tried). */
  loaderSets: readonly (readonly string[])[];
  codes: { notPack: string; noVersion: string };
}

export const RESOURCE_PACK_DOWNLOAD: PackDownloadKind = {
  projectType: "resourcepack",
  loaderSets: [["minecraft"]],
  codes: { notPack: "NOT_A_PACK", noVersion: "PACK_NO_VERSION" },
};

/** What runs shader packs on a site; Iris is the one this launcher can run. */
export const SHADER_LOADERS = ["iris", "optifine", "canvas", "vanilla"];

export const SHADER_DOWNLOAD: PackDownloadKind = {
  projectType: "shader",
  loaderSets: [["iris"], SHADER_LOADERS],
  codes: { notPack: "NOT_A_SHADER", noVersion: "SHADER_NO_VERSION" },
};

export async function downloadPack(
  { downloader, library, source }: DownloadPackDeps,
  projectId: string,
  {
    gameVersion,
    kind = RESOURCE_PACK_DOWNLOAD,
    signal,
    onProgress,
  }: {
    /** The profile's Minecraft version; missing = any. */
    gameVersion?: string;
    /** Resource packs unless given. */
    kind?: PackDownloadKind;
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
  } = {},
): Promise<{
  sha1: string;
  version: RemoteVersion;
  project?: RemoteProject;
  otherVersion: boolean;
  needs: PackNeed[];
}> {
  let version: RemoteVersion | null = null;
  let otherVersion = false;
  find: for (const game of gameVersion ? [gameVersion, ""] : [""]) {
    for (const loaders of kind.loaderSets) {
      version = await source.getCompatibleVersion(
        projectId,
        {
          projectType: kind.projectType,
          loaders: [...loaders],
          gameVersion: game,
        },
        signal,
      );
      if (version) {
        otherVersion = game === "" && gameVersion !== undefined;
        break find;
      }
    }
  }
  if (!version)
    throw new AppError(
      kind.codes.noVersion,
      "This pack has no version to download.",
    );
  if (!/\.zip$/i.test(version.file.fileName))
    throw new AppError(
      kind.codes.notPack,
      `${version.file.fileName} isn't a zip.`,
    );

  const { sha1, url, size, fileName } = version.file;
  const dest = library.storeFile(sha1);
  const known = (await library.meta(sha1)) !== undefined;
  let project: RemoteProject | undefined;
  try {
    if (!(await exists(dest)))
      await downloader.run([{ dest, url, sha1, size }], {
        ...(signal && { signal }),
        ...(onProgress && { onProgress }),
      });
    if (signal?.aborted) throw new AppError("CANCELLED", "Download cancelled.");
    project = (await source.getProjects([projectId], signal))[0];
    await library.addStored([
      {
        sha1,
        fileName,
        loaders: version.loaders,
        source: {
          sourceId: version.sourceId,
          projectId,
          versionId: version.versionId,
          pageUrl:
            project?.pageUrl ?? source.pageUrl(projectId, kind.projectType),
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
    ...(project && { project }),
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
