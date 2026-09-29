import type { ModSource, ModTarget, RemoteVersion } from "./types";

/** What the resolver needs to know about the library, seen from one profile. */
export interface LibraryView {
  /**
   * A library mod from this project that can be used in the profile (enabled
   * there already, or compatible), to reuse instead of downloading.
   */
  findUsable(
    sourceId: string,
    projectId: string,
  ): { sha1: string; name: string } | undefined;
  /** Mods from this project enabled in the profile. */
  enabledFromProject(
    sourceId: string,
    projectId: string,
  ): { sha1: string; name: string }[];
  /** Is this file already in the store (nothing to download)? */
  hasFile(sha1: string): boolean;
}

export type PlanItem =
  | { action: "download"; version: RemoteVersion; root: boolean }
  | { action: "reuse"; projectId: string; sha1: string; name: string };

export interface InstallPlan {
  sourceId: string;
  /** The requested mod first, then its required dependencies. */
  items: PlanItem[];
  /** Required dependencies with no version for the profile: nothing may be downloaded. */
  missing: { projectId?: string; versionId?: string }[];
  /** Enabled mods (by project id) that a mod in the plan says it's incompatible with. */
  incompatible: string[];
  /** Enabled mods that downloading replaces (another version of the same project). */
  replaces: { sha1: string; name: string }[];
  /** Bytes to download (files already stored count 0). */
  totalSize: number;
}

/**
 * Everything to download or reuse for one mod: its required dependencies,
 * recursively, stopping on cycles. Uses only the `ModSource` interface.
 */
export async function resolveInstall(
  source: ModSource,
  root: RemoteVersion,
  target: ModTarget,
  library: LibraryView,
  signal?: AbortSignal,
): Promise<InstallPlan> {
  const plan: InstallPlan = {
    sourceId: source.id,
    items: [],
    missing: [],
    incompatible: [],
    replaces: [],
    totalSize: 0,
  };
  const visited = new Set<string>();

  async function visit(version: RemoteVersion, isRoot: boolean): Promise<void> {
    visited.add(version.projectId);
    plan.items.push({ action: "download", version, root: isRoot });
    if (!library.hasFile(version.file.sha1))
      plan.totalSize += version.file.size;
    for (const old of library.enabledFromProject(
      source.id,
      version.projectId,
    )) {
      if (old.sha1 !== version.file.sha1) plan.replaces.push(old);
    }

    for (const dep of version.dependencies) {
      if (dep.kind === "incompatible") {
        if (
          dep.projectId &&
          library.enabledFromProject(source.id, dep.projectId).length > 0 &&
          !plan.incompatible.includes(dep.projectId)
        )
          plan.incompatible.push(dep.projectId);
        continue;
      }
      if (dep.kind !== "required") continue; // optional ones are left out

      let pinned: RemoteVersion | undefined;
      let projectId = dep.projectId;
      if (dep.versionId) {
        pinned = await source
          .getVersion(dep.versionId, signal)
          .catch(() => undefined);
        projectId ??= pinned?.projectId;
      }
      if (!projectId) {
        plan.missing.push({
          ...(dep.versionId && { versionId: dep.versionId }),
        });
        continue;
      }
      if (visited.has(projectId)) continue;

      const usable = library.findUsable(source.id, projectId);
      if (usable) {
        visited.add(projectId);
        plan.items.push({ action: "reuse", projectId, ...usable });
        continue;
      }
      const next =
        pinned ??
        (dep.versionId
          ? undefined
          : await source.getCompatibleVersion(projectId, target, signal));
      if (!next) {
        visited.add(projectId);
        plan.missing.push({
          projectId,
          ...(dep.versionId && { versionId: dep.versionId }),
        });
        continue;
      }
      await visit(next, false);
    }
  }

  await visit(root, true);
  return plan;
}
