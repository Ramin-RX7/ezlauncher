import { describe, expect, it } from "vitest";
import type { LibraryMod } from "@shared/launcher";
import { libraryTree, type LibraryNode } from "./libraryTree";

const mod = (sha1: string, extra: Partial<LibraryMod> = {}): LibraryMod => ({
  sha1,
  fileName: `${sha1}.jar`,
  name: sha1,
  loaders: ["fabric"],
  hasIcon: false,
  addedAt: "2026-09-01T00:00:00Z",
  usedBy: [],
  checked: true,
  ...extra,
});

const shape = (nodes: LibraryNode[]): unknown =>
  nodes.map((n) =>
    n.children.length ? { [n.mod.sha1]: shape(n.children) } : n.mod.sha1,
  );

describe("libraryTree", () => {
  it("nests dependencies under every mod that needs them", () => {
    const tree = libraryTree([
      mod("api", { dependency: true, neededBy: ["sodium", "iris"] }),
      mod("iris", { neededBy: [] }),
      mod("sodium"),
    ]);
    expect(shape(tree)).toEqual([{ iris: ["api"] }, { sodium: ["api"] }]);
  });

  it("nests a dependency's own dependencies", () => {
    const tree = libraryTree([
      mod("a"),
      mod("b", { dependency: true, neededBy: ["a"] }),
      mod("c", { dependency: true, neededBy: ["b"] }),
    ]);
    expect(shape(tree)).toEqual([{ a: [{ b: ["c"] }] }]);
  });

  it("keeps the user's own mods at the top even when others need them", () => {
    const tree = libraryTree([
      mod("api", { dependency: false, neededBy: ["sodium"] }),
      mod("sodium"),
    ]);
    expect(shape(tree)).toEqual(["api", "sodium"]);
  });

  it("shows a dependency nothing needs, and survives cycles", () => {
    const tree = libraryTree([
      mod("lonely", { dependency: true, neededBy: [] }),
      mod("x", { dependency: true, neededBy: ["y"] }),
      mod("y", { dependency: true, neededBy: ["x"] }),
    ]);
    expect(shape(tree)).toEqual(["lonely", { x: ["y"] }]);
  });
});
