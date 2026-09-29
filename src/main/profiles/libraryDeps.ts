import type { ModMeta } from "./mods";

/*
 * Which library mods other library mods need, from the jars' own metadata. A mod
 * is needed by M when M depends on an id it has as its mod id, in `provides`, or
 * inside one of its bundled (nested) jars.
 */

type DepMeta = Pick<
  ModMeta,
  "modId" | "provides" | "nested" | "depends" | "addedAs"
>;

function providedIds(meta: DepMeta): Set<string> {
  const ids = new Set<string>(meta.provides ?? []);
  if (meta.modId) ids.add(meta.modId);
  for (const n of meta.nested ?? []) {
    ids.add(n.modId);
    for (const p of n.provides ?? []) ids.add(p);
  }
  return ids;
}

/** Library mod (sha1) → the library mods (sha1s) that depend on it. */
export function libraryNeededBy(
  mods: Readonly<Record<string, DepMeta>>,
): Map<string, string[]> {
  const providers = new Map<string, string[]>(); // id → sha1s that provide it
  for (const [sha1, meta] of Object.entries(mods)) {
    for (const id of providedIds(meta)) {
      const list = providers.get(id) ?? [];
      list.push(sha1);
      providers.set(id, list);
    }
  }
  const neededBy = new Map<string, string[]>();
  for (const [sha1, meta] of Object.entries(mods)) {
    const own = providedIds(meta);
    for (const dep of meta.depends ?? []) {
      if (own.has(dep.id)) continue; // bundled inside the mod itself
      for (const provider of providers.get(dep.id) ?? []) {
        if (provider === sha1) continue;
        const list = neededBy.get(provider) ?? [];
        if (!list.includes(sha1)) list.push(sha1);
        neededBy.set(provider, list);
      }
    }
  }
  return neededBy;
}

/**
 * Only there as a dependency: pulled in for another mod, or (for entries older than
 * the `addedAs` record) needed by another library mod. A mod the user added is never one.
 */
export function isDependencyOnly(
  meta: DepMeta,
  neededBy: readonly string[],
): boolean {
  if (meta.addedAs) return meta.addedAs === "dependency";
  return neededBy.length > 0;
}
