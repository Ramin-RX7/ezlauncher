import type { ModSource, ModTarget, RemoteVersion } from "./types";

/*
 * Re-fetch a set of already-known projects for a (possibly new) target: for each
 * project, the version that fits the target, or nothing when there is none. Uses
 * only the `ModSource` interface, so it stays testable with a fake source.
 */

export interface BulkResult {
  found: { projectId: string; version: RemoteVersion }[];
  /** Projects with no version for the target. */
  none: { projectId: string }[];
}

/**
 * The compatible version of each project for the target. Only the projects
 * themselves are looked up (no dependency recursion): the caller already has the
 * set of mods it wants, and each dependency is its own library entry.
 */
export async function resolveBulk(
  source: ModSource,
  projectIds: readonly string[],
  target: ModTarget,
  signal?: AbortSignal,
): Promise<BulkResult> {
  const result: BulkResult = { found: [], none: [] };
  for (const projectId of new Set(projectIds)) {
    const version = await source
      .getCompatibleVersion(projectId, target, signal)
      .catch(() => null);
    if (version) result.found.push({ projectId, version });
    else result.none.push({ projectId });
  }
  return result;
}
