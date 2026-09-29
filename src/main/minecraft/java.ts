import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { DownloadProgress, Downloader } from "./downloader";
import type { FileTask } from "./fileTask";
import { safeJoin, type Paths } from "./paths";
import {
  javaExecutableRelPath,
  javaPlatformKeys,
  type Platform,
} from "./platform";
import {
  javaAllSchema,
  runtimeManifestSchema,
  runtimeMarkerSchema,
  type JavaAll,
  type RuntimeManifest,
} from "./schemas";
import { checkFiles, type CheckMode } from "./verify";

export const JAVA_ALL_URL =
  "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const JAVA_ALL_CACHE = "java_all.json";

/** Old versions have no `javaVersion`; they run on Java 8. */
export const DEFAULT_JAVA_COMPONENT = "jre-legacy";

export interface EnsureJavaOptions {
  component: string;
  platform: Platform;
  paths: Paths;
  downloader: Downloader;
  mode: CheckMode;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
}

/** Pick the first platform key that actually offers this Java component. */
export function pickJavaPlatform(
  all: JavaAll,
  component: string,
  platform: Platform,
): string {
  for (const key of javaPlatformKeys(platform)) {
    if ((all[key]?.[component]?.length ?? 0) > 0) return key;
  }
  throw new AppError(
    "JAVA_UNAVAILABLE",
    `Mojang offers no Java runtime "${component}" for ${platform.os}-${platform.arch}.`,
  );
}

async function loadJavaAll(
  paths: Paths,
  downloader: Downloader,
  signal?: AbortSignal,
) {
  const cacheFile = paths.launcherFile(JAVA_ALL_CACHE);
  try {
    const all = javaAllSchema.parse(
      JSON.parse(await downloader.fetchText(JAVA_ALL_URL, { signal })),
    );
    await writeJsonAtomic(cacheFile, all);
    return all;
  } catch (err) {
    if (err instanceof AppError && err.code === "CANCELLED") throw err;
    const cached = await readJson(cacheFile, javaAllSchema).catch(
      () => undefined,
    );
    if (cached) return cached;
    throw err;
  }
}

function runtimeFileTasks(manifest: RuntimeManifest, dir: string): FileTask[] {
  const tasks: FileTask[] = [];
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (entry.type !== "file") continue;
    const { url, sha1, size } = entry.downloads.raw;
    tasks.push({ dest: safeJoin(dir, path), url, sha1, size });
  }
  return tasks;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a symlink, or copy the target when the system refuses symlinks
 * (Windows without admin rights or Developer Mode, some network or FAT drives).
 * A copy works the same for a Java runtime.
 */
async function linkOrCopy(linkTarget: string, path: string): Promise<void> {
  try {
    await symlink(linkTarget, path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code !== "EPERM" &&
      code !== "EACCES" &&
      code !== "ENOTSUP" &&
      code !== "EINVAL"
    ) {
      throw err;
    }
    const source = resolve(dirname(path), linkTarget);
    if (await exists(source)) await copyFile(source, path);
  }
}

/** Create folders and links, and mark executables, after the files are downloaded. */
async function finishRuntime(
  manifest: RuntimeManifest,
  dir: string,
  platform: Platform,
) {
  const entries = Object.entries(manifest.files);
  for (const [path, entry] of entries) {
    if (entry.type === "directory")
      await mkdir(safeJoin(dir, path), { recursive: true });
  }
  for (const [path, entry] of entries) {
    const target = safeJoin(dir, path);
    if (
      entry.type === "file" &&
      entry.executable &&
      platform.os !== "windows"
    ) {
      await chmod(target, 0o755);
    }
    if (entry.type === "link" && !(await exists(target))) {
      await mkdir(dirname(target), { recursive: true });
      await linkOrCopy(entry.target, target);
    }
  }
}

/**
 * Make sure a Java runtime is installed and complete, and return its executable.
 * With `quick` mode and a complete install, this makes no network requests.
 */
export async function ensureJava(options: EnsureJavaOptions): Promise<string> {
  const { component, platform, paths, downloader, mode, signal, onProgress } =
    options;
  const dir = paths.runtimeDir(component);
  const executable = join(dir, ...javaExecutableRelPath(platform).split("/"));

  let manifest: RuntimeManifest | undefined;
  let platformKey: string | undefined;
  const marker = await readJson(
    paths.runtimeMarker(component),
    runtimeMarkerSchema,
  ).catch(() => undefined);
  if (marker) {
    manifest = await readJson(
      paths.runtimeManifest(component),
      runtimeManifestSchema,
    ).catch(() => undefined);
    platformKey = marker.platform;
  }

  let versionName: string | undefined;
  if (!manifest) {
    const all = await loadJavaAll(paths, downloader, signal);
    platformKey = pickJavaPlatform(all, component, platform);
    const entry = all[platformKey]?.[component]?.[0];
    if (!entry)
      throw new AppError("JAVA_UNAVAILABLE", `No Java runtime "${component}".`);
    versionName = entry.version?.name;
    const text = await downloader.fetchText(entry.manifest.url, { signal });
    if (createHash("sha1").update(text).digest("hex") !== entry.manifest.sha1) {
      throw new AppError(
        "HASH_MISMATCH",
        `Java runtime manifest for ${component} is damaged.`,
      );
    }
    manifest = runtimeManifestSchema.parse(JSON.parse(text));
    await writeJsonAtomic(paths.runtimeManifest(component), manifest);
  }

  const missing = await checkFiles(runtimeFileTasks(manifest, dir), mode);
  if (missing.length > 0) {
    await downloader.run(missing, {
      ...(signal && { signal }),
      ...(onProgress && { onProgress }),
    });
  }
  await finishRuntime(manifest, dir, platform);

  if (!marker || missing.length > 0) {
    await writeJsonAtomic(paths.runtimeMarker(component), {
      schema: 1,
      component,
      platform: platformKey ?? "unknown",
      ...((versionName ?? marker?.versionName) && {
        versionName: versionName ?? marker?.versionName,
      }),
      installedAt: new Date().toISOString(),
    });
  }
  return executable;
}
