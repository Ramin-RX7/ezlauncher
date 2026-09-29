import type { LibraryMod } from "@shared/launcher";

export interface LibraryNode {
  mod: LibraryMod;
  /** Dependency-only mods this one needs, shown nested under it. */
  children: LibraryNode[];
}

/**
 * The library as a tree: the user's own mods at the top, each dependency-only mod
 * nested under every library mod that needs it. A dependency nothing in the library
 * needs any more (or one caught in a cycle) is shown at the top level.
 */
export function libraryTree(mods: readonly LibraryMod[]): LibraryNode[] {
  const present = new Set(mods.map((m) => m.sha1));
  const childrenOf = new Map<string, LibraryMod[]>();
  for (const m of mods) {
    if (!m.dependency) continue;
    for (const parent of m.neededBy ?? []) {
      if (!present.has(parent) || parent === m.sha1) continue;
      const list = childrenOf.get(parent) ?? [];
      list.push(m);
      childrenOf.set(parent, list);
    }
  }

  const shown = new Set<string>();
  const build = (mod: LibraryMod, path: ReadonlySet<string>): LibraryNode => {
    shown.add(mod.sha1);
    return {
      mod,
      children: (childrenOf.get(mod.sha1) ?? [])
        .filter((c) => !path.has(c.sha1))
        .map((c) => build(c, new Set([...path, c.sha1]))),
    };
  };

  const isRoot = (m: LibraryMod) =>
    !m.dependency || !(m.neededBy ?? []).some((p) => present.has(p));
  const tree = mods.filter(isRoot).map((m) => build(m, new Set([m.sha1])));
  for (const m of mods)
    if (!shown.has(m.sha1)) tree.push(build(m, new Set([m.sha1])));
  return tree;
}
