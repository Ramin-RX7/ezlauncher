import type { RemoteMatchCard } from "@shared/launcher";
import type { InstallPlan } from "./resolveDependencies";
import type { RemoteProject, RemoteVersion } from "./types";

/** A search hit as the Add mod dialog shows it, before a version is known. */
export function projectCard(
  sourceId: string,
  project: RemoteProject,
): RemoteMatchCard {
  return {
    sourceId,
    project: {
      projectId: project.projectId,
      name: project.name,
      author: project.author,
      ...(project.iconUrl && { iconUrl: project.iconUrl }),
      pageUrl: project.pageUrl,
      ...(project.downloads !== undefined && { downloads: project.downloads }),
    },
    version: null,
    dependencies: [],
    missing: [],
    incompatible: [],
    replaces: [],
    totalSize: 0,
  };
}

/** The projects whose names a plan's card shows: dependencies to download and missing ones. */
export function projectsToName(plan: InstallPlan): string[] {
  const ids = new Set<string>();
  for (const item of plan.items)
    if (item.action === "download" && !item.root)
      ids.add(item.version.projectId);
  for (const m of plan.missing) if (m.projectId) ids.add(m.projectId);
  return [...ids];
}

/**
 * What Download would do, in words: the version, each dependency (downloaded or
 * reused), what's missing, which enabled mods clash or get replaced, and the size.
 * `names` holds project names from the site (a file name stands in when one is
 * missing); `incompatible` the names of the enabled mods that clash.
 */
export function describePlan(
  version: RemoteVersion,
  plan: InstallPlan,
  names: ReadonlyMap<string, string>,
  incompatible: string[],
): Pick<
  RemoteMatchCard,
  | "version"
  | "dependencies"
  | "missing"
  | "incompatible"
  | "replaces"
  | "totalSize"
> {
  return {
    version: {
      versionNumber: version.versionNumber,
      fileName: version.file.fileName,
    },
    dependencies: plan.items.flatMap(
      (item): RemoteMatchCard["dependencies"] => {
        if (item.action === "reuse")
          return [{ name: item.name, action: "reuse" as const }];
        if (item.root) return [];
        return [
          {
            name:
              names.get(item.version.projectId) ?? item.version.file.fileName,
            versionNumber: item.version.versionNumber,
            action: "download" as const,
          },
        ];
      },
    ),
    missing: plan.missing.map(
      (m) =>
        (m.projectId && names.get(m.projectId)) ??
        m.projectId ??
        m.versionId ??
        "?",
    ),
    incompatible,
    replaces: plan.replaces.map((m) => m.name),
    totalSize: plan.totalSize,
  };
}
