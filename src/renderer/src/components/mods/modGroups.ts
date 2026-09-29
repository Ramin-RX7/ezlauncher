import type { LibraryMod } from "@shared/launcher";

/** One mod with every version of it in the library. */
export interface ModGroup {
  key: string;
  /** Newest version first. */
  versions: LibraryMod[];
  /** The one shown: enabled in the profile, else the newest that fits, else the newest. */
  current: LibraryMod;
}

function groupKey(m: LibraryMod): string {
  if (m.modId) return `id:${m.modId}`;
  if (m.source) return `source:${m.source.sourceId}:${m.source.projectId}`;
  return `file:${m.sha1}`;
}

const newestFirst = (a: LibraryMod, b: LibraryMod) =>
  (b.version ?? "").localeCompare(a.version ?? "", undefined, {
    numeric: true,
  }) || b.addedAt.localeCompare(a.addedAt);

/**
 * Library files grouped into mods (by mod id, else by project on its site), so two
 * Sodium jars are one Sodium. A group has at most one enabled version: extra enabled
 * copies (dropped in by hand) get their own group, so they can still be unticked.
 */
export function groupMods(mods: readonly LibraryMod[]): ModGroup[] {
  const byKey = new Map<string, LibraryMod[]>();
  const extra: LibraryMod[][] = [];
  for (const m of mods) {
    const key = groupKey(m);
    const list = byKey.get(key) ?? [];
    if (m.enabled && list.some((o) => o.enabled)) extra.push([m]);
    else byKey.set(key, [...list, m]);
  }
  return [
    ...[...byKey].map(([key, list]) => ({ key, list })),
    ...extra.map((list) => ({ key: `file:${list[0]?.sha1 ?? ""}`, list })),
  ].flatMap(({ key, list }) => {
    const versions = [...list].sort(newestFirst);
    const current =
      versions.find((v) => v.enabled) ??
      versions.find((v) => v.compat?.status === "compatible") ??
      versions.find((v) => v.compat?.status !== "incompatible") ??
      versions[0];
    return current ? [{ key, versions, current }] : [];
  });
}
