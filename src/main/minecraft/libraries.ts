import type { FileTask } from "./fileTask";
import { uniqueTasks } from "./fileTask";
import { coordinateToPath, parseCoordinate } from "./maven";
import type { Paths } from "./paths";
import { rulesAllow, type RuleEnv } from "./rules";
import type { Artifact, Library, VersionJson } from "./schemas";

export const MOJANG_LIBRARIES_URL = "https://libraries.minecraft.net/";

export interface NativeJar {
  task: FileTask;
  /** Path prefixes inside the jar that must not be extracted (e.g. `META-INF/`). */
  exclude: string[];
}

export interface CollectedLibraries {
  /** Jars for the classpath, in order. */
  classpath: FileTask[];
  /** Old-style native jars (≤ 1.18) that must be extracted into the natives folder. */
  natives: NativeJar[];
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Turn a library artifact (or its Maven coordinate) into a file task. */
function artifactTask(
  lib: Library,
  artifact: Artifact | undefined,
  classifier: string | undefined,
  paths: Paths,
): FileTask | undefined {
  let relPath = artifact?.path;
  if (!relPath) {
    const coordinate = parseCoordinate(lib.name);
    if (!coordinate) return undefined;
    relPath = coordinateToPath(
      classifier ? { ...coordinate, classifier } : coordinate,
    );
  }

  // An artifact entry with an empty url is a file produced locally (mod loader installers).
  let url: string | undefined;
  if (artifact) url = artifact.url || undefined;
  else url = withTrailingSlash(lib.url ?? MOJANG_LIBRARIES_URL) + relPath;

  const sha1 = artifact?.sha1 ?? (classifier ? undefined : lib.sha1);
  const size = artifact?.size ?? (classifier ? undefined : lib.size);
  return {
    dest: paths.library(relPath),
    ...(url && { url }),
    ...(sha1 && { sha1 }),
    ...(size !== undefined && { size }),
  };
}

export function collectLibraries(
  version: VersionJson,
  env: RuleEnv,
  paths: Paths,
): CollectedLibraries {
  const classpath: FileTask[] = [];
  const natives: NativeJar[] = [];

  for (const lib of version.libraries ?? []) {
    if (!rulesAllow(lib.rules, env)) continue;

    const nativeKey = lib.natives?.[env.platform.os];
    if (nativeKey) {
      const classifier = nativeKey.replace(
        "${arch}",
        env.platform.arch === "x86" ? "32" : "64",
      );
      const task = artifactTask(
        lib,
        lib.downloads?.classifiers?.[classifier],
        classifier,
        paths,
      );
      if (task)
        natives.push({ task, exclude: lib.extract?.exclude ?? ["META-INF/"] });
    }

    // A library with only natives (no artifact) has nothing for the classpath.
    if (lib.natives && !lib.downloads?.artifact && lib.downloads?.classifiers)
      continue;
    const task = artifactTask(lib, lib.downloads?.artifact, undefined, paths);
    if (task) classpath.push(task);
  }

  return { classpath: uniqueTasks(classpath), natives };
}
