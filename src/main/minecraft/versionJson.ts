import { AppError } from "../core/errors";
import { readJson } from "../core/fsAtomic";
import { libraryKey } from "./maven";
import type { Paths } from "./paths";
import { versionJsonSchema, type VersionJson } from "./schemas";

export interface ResolvedVersion extends VersionJson {
  /** Version ids from the requested one down to its root parent, e.g. `[fabric-…, 1.18.2]`. */
  chain: string[];
}

export type VersionLoader = (id: string) => Promise<VersionJson>;

export function diskVersionLoader(paths: Paths): VersionLoader {
  return async (id) => {
    const json = await readJson(paths.versionJson(id), versionJsonSchema);
    if (!json)
      throw new AppError(
        "VERSION_NOT_FOUND",
        `Version ${id} is not downloaded.`,
      );
    return json;
  };
}

/**
 * Merge a child version (e.g. a mod loader) over its parent:
 * the child wins for single values, its libraries come first and replace the parent's
 * library with the same `group:artifact[:classifier]`, and arguments are appended.
 */
export function mergeVersions(
  parent: VersionJson,
  child: VersionJson,
): VersionJson {
  const childLibs = child.libraries ?? [];
  const childKeys = new Set(childLibs.map((l) => libraryKey(l.name)));
  const libraries = [
    ...childLibs,
    ...(parent.libraries ?? []).filter(
      (l) => !childKeys.has(libraryKey(l.name)),
    ),
  ];

  const parentArgs = parent.arguments;
  const childArgs = child.arguments;
  const args =
    parentArgs || childArgs
      ? {
          game: [...(parentArgs?.game ?? []), ...(childArgs?.game ?? [])],
          jvm: [...(parentArgs?.jvm ?? []), ...(childArgs?.jvm ?? [])],
        }
      : undefined;

  const merged: VersionJson = { ...parent, ...child, libraries };
  if (args) merged.arguments = args;
  delete merged.inheritsFrom;
  return merged;
}

/** Load a version and follow its `inheritsFrom` chain to any depth. */
export async function resolveVersion(
  id: string,
  load: VersionLoader,
): Promise<ResolvedVersion> {
  const chain: VersionJson[] = [];
  const seen = new Set<string>();
  let nextId: string | undefined = id;
  while (nextId) {
    if (seen.has(nextId)) {
      throw new AppError(
        "VERSION_CYCLE",
        `Version ${id} inherits from itself.`,
      );
    }
    seen.add(nextId);
    const json = await load(nextId);
    chain.push(json);
    nextId = json.inheritsFrom;
  }

  // Merge from the root parent up to the requested version.
  let merged = chain[chain.length - 1] as VersionJson;
  for (let i = chain.length - 2; i >= 0; i--) {
    merged = mergeVersions(merged, chain[i] as VersionJson);
  }
  return { ...merged, id, chain: chain.map((v) => v.id) };
}
