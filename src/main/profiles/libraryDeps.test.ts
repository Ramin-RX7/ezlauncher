import { describe, expect, it } from "vitest";
import { isDependencyOnly, libraryNeededBy } from "./libraryDeps";

const dep = (id: string) => ({ id, range: "*", format: "semver" as const });

describe("libraryNeededBy", () => {
  it("links a mod to the library mods that depend on its id", () => {
    const needed = libraryNeededBy({
      sodium: {
        modId: "sodium",
        depends: [dep("fabric-api"), dep("minecraft")],
      },
      api: { modId: "fabric-api" },
      other: { modId: "other" },
    });
    expect(needed.get("api")).toEqual(["sodium"]);
    expect(needed.has("other")).toBe(false);
  });

  it("counts provides and bundled (nested) mods", () => {
    const needed = libraryNeededBy({
      indium: { modId: "indium", depends: [dep("fabric-renderer-api-v1")] },
      api: {
        modId: "fabric-api",
        nested: [{ modId: "fabric-renderer-api-v1" }],
      },
      lib: { modId: "lib", provides: ["cloth"] },
      user: { modId: "user", depends: [dep("cloth")] },
    });
    expect(needed.get("api")).toEqual(["indium"]);
    expect(needed.get("lib")).toEqual(["user"]);
  });

  it("ignores what a mod bundles inside itself", () => {
    const needed = libraryNeededBy({
      a: { modId: "a", nested: [{ modId: "x" }], depends: [dep("x")] },
      b: { modId: "x" },
    });
    expect(needed.has("b")).toBe(false);
  });
});

describe("isDependencyOnly", () => {
  it("trusts the recorded origin", () => {
    expect(isDependencyOnly({ addedAs: "user" }, ["x"])).toBe(false);
    expect(isDependencyOnly({ addedAs: "dependency" }, [])).toBe(true);
  });

  it("infers from other mods needing it when nothing was recorded", () => {
    expect(isDependencyOnly({}, ["x"])).toBe(true);
    expect(isDependencyOnly({}, [])).toBe(false);
  });
});
