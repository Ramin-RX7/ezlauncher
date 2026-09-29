import { rm, stat } from "node:fs/promises";
import type { InstallProgress, InstallStep } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import { applyLegacyAssets, assetIndexId, assetObjectTasks } from "./assets";
import type { Downloader } from "./downloader";
import type { FileTask } from "./fileTask";
import { uniqueTasks } from "./fileTask";
import { DEFAULT_JAVA_COMPONENT, ensureJava } from "./java";
import { collectLibraries, type CollectedLibraries } from "./libraries";
import { findManifestEntry } from "./manifest";
import { extractNatives } from "./natives";
import type { Paths } from "./paths";
import type { Platform } from "./platform";
import {
  assetIndexSchema,
  installMarkerSchema,
  versionJsonSchema,
  type AssetIndex,
  type VersionJson,
} from "./schemas";
import { checkFiles, isFileValid, type CheckMode } from "./verify";
import { resolveVersion, type ResolvedVersion } from "./versionJson";

export interface InstallDeps {
  paths: Paths;
  downloader: Downloader;
  platform: Platform;
  logger?: Logger;
}

/**
 * - `install`: first install (quick checks, download what's missing).
 * - `quick`: before launch. Exists + size checks only; no network if nothing is missing.
 * - `repair`: full SHA1 check of every file, re-download anything wrong.
 */
export type InstallMode = "install" | "quick" | "repair";

export interface InstallOptions {
  mode: InstallMode;
  signal?: AbortSignal;
  onProgress?: (p: InstallProgress) => void;
}

/** Everything a launch needs, as computed during install. */
export interface InstalledVersion {
  version: ResolvedVersion;
  libraries: CollectedLibraries;
  clientJar: string;
  assetIndex: AssetIndex;
  assetIndexId: string;
  javaPath: string;
}

/** The vanilla version at the root of the inheritance chain owns the game jar. */
export function clientJarVersionId(version: ResolvedVersion): string {
  return version.chain[version.chain.length - 1] ?? version.id;
}

export async function isInstalled(paths: Paths, id: string): Promise<boolean> {
  try {
    return (
      (await readJson(paths.installMarker(id), installMarkerSchema)) !==
      undefined
    );
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function installVersion(
  deps: InstallDeps,
  versionId: string,
  { mode, signal, onProgress }: InstallOptions,
): Promise<InstalledVersion> {
  const { paths, downloader, platform, logger } = deps;
  const checkMode: CheckMode = mode === "repair" ? "full" : "quick";
  const report = (
    step: InstallStep,
    p = { files: 0, totalFiles: 0, bytes: 0, totalBytes: 0 },
  ) => onProgress?.({ versionId, step, ...p });
  const run = (tasks: FileTask[], step: InstallStep) =>
    downloader.run(tasks, {
      ...(signal && { signal }),
      onProgress: (p) => {
        report(step, p);
      },
    });

  // 1. Version JSONs (the whole inheritsFrom chain). Reuse files on disk unless repairing.
  report("metadata");
  const loadOrDownload = async (id: string): Promise<VersionJson> => {
    const dest = paths.versionJson(id);
    if (mode === "repair" || !(await fileExists(dest))) {
      const entry = await findManifestEntry({ paths, downloader }, id);
      const task: FileTask = {
        dest,
        url: entry.url,
        ...(entry.sha1 && { sha1: entry.sha1 }),
      };
      if (!(await isFileValid(task, "full"))) await run([task], "metadata");
    }
    const json = await readJson(dest, versionJsonSchema);
    if (!json)
      throw new AppError(
        "VERSION_NOT_FOUND",
        `Version ${id} is not downloaded.`,
      );
    return json;
  };
  const version = await resolveVersion(versionId, loadOrDownload);

  // 2. Asset index.
  const indexId = assetIndexId(version);
  if (version.assetIndex) {
    const { url, sha1, size } = version.assetIndex;
    const indexTask: FileTask = {
      dest: paths.assetIndex(indexId),
      url,
      sha1,
      size,
    };
    const bad = await checkFiles([indexTask], checkMode);
    if (bad.length > 0) await run(bad, "metadata");
  }
  const assetIndex = (await readJson(
    paths.assetIndex(indexId),
    assetIndexSchema,
  )) ?? {
    objects: {},
  };

  // 3. Every file the version needs.
  const env = { platform };
  const libraries = collectLibraries(version, env, paths);
  const jarId = clientJarVersionId(version);
  const clientJar = paths.clientJar(jarId);
  const tasks: FileTask[] = [
    ...libraries.classpath,
    ...libraries.natives.map((n) => n.task),
  ];
  const client = version.downloads?.client;
  tasks.push({
    dest: clientJar,
    ...(client && { url: client.url, sha1: client.sha1, size: client.size }),
  });
  const logFile = version.logging?.client?.file;
  if (logFile) {
    tasks.push({
      dest: paths.logConfig(logFile.id),
      url: logFile.url,
      sha1: logFile.sha1,
      size: logFile.size,
    });
  }
  tasks.push(...assetObjectTasks(assetIndex, paths));

  report("checking");
  const missing = await checkFiles(uniqueTasks(tasks), checkMode);
  if (missing.length > 0) {
    logger?.info(
      `${versionId}: downloading ${missing.length} of ${tasks.length} files`,
    );
    await run(missing, "downloading");
  }

  // 4. Java.
  report("java");
  const javaPath = await ensureJava({
    component: version.javaVersion?.component ?? DEFAULT_JAVA_COMPONENT,
    platform,
    paths,
    downloader,
    mode: checkMode,
    ...(signal && { signal }),
    onProgress: (p) => {
      report("java", p);
    },
  });

  // 5. Natives: re-extract when anything changed or the folder is gone.
  const nativesDir = paths.nativesDir(versionId);
  const nativesChanged = missing.some((t) =>
    libraries.natives.some((n) => n.task.dest === t.dest),
  );
  if (
    libraries.natives.length > 0 &&
    (mode !== "quick" || nativesChanged || !(await dirExists(nativesDir)))
  ) {
    report("natives");
    await extractNatives(libraries.natives, nativesDir);
  }

  // 6. Old versions read assets by name.
  report("assets");
  await applyLegacyAssets(assetIndex, indexId, paths, paths.gameDir(versionId));

  // 7. The marker comes last: without it, the version counts as not installed.
  if (mode !== "quick" || !(await isInstalled(paths, versionId))) {
    await writeJsonAtomic(paths.installMarker(versionId), {
      schema: 1,
      versionId,
      installedAt: new Date().toISOString(),
    });
  }

  return {
    version,
    libraries,
    clientJar,
    assetIndex,
    assetIndexId: indexId,
    javaPath,
  };
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Remove a version's own folder. Shared libraries and assets stay. */
export async function deleteVersion(
  paths: Paths,
  id: string,
  { deleteGameDir }: { deleteGameDir: boolean },
): Promise<void> {
  // Remove the marker first, so a half-finished delete never looks installed.
  await rm(paths.installMarker(id), { force: true });
  await rm(paths.versionDir(id), { recursive: true, force: true });
  if (deleteGameDir)
    await rm(paths.gameDir(id), { recursive: true, force: true });
}
