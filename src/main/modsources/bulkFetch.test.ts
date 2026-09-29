import { describe, expect, it } from "vitest";
import { createFakeModSource } from "./testing/fakeModSource";
import { resolveBulk } from "./bulkFetch";

const target = { gameVersion: "1.20.1", loaders: ["fabric"] };

const source = createFakeModSource(
  [
    { projectId: "sodium", name: "Sodium" },
    { projectId: "lithium", name: "Lithium" },
    { projectId: "old-mod", name: "Old Mod" },
  ],
  [
    {
      projectId: "sodium",
      versionId: "s-1",
      sha1: "aa",
      gameVersions: ["1.20.1"],
    },
    {
      projectId: "lithium",
      versionId: "l-1",
      sha1: "bb",
      gameVersions: ["1.20.1"],
    },
    // old-mod only has a 1.18.2 build: nothing fits 1.20.1.
    {
      projectId: "old-mod",
      versionId: "o-1",
      sha1: "cc",
      gameVersions: ["1.18.2"],
    },
  ],
);

describe("resolveBulk", () => {
  it("finds the compatible version of each project for the target", async () => {
    const res = await resolveBulk(
      source,
      ["sodium", "lithium", "old-mod"],
      target,
    );
    expect(res.found.map((f) => f.projectId).sort()).toEqual([
      "lithium",
      "sodium",
    ]);
    expect(res.none.map((n) => n.projectId)).toEqual(["old-mod"]);
    expect(
      res.found.find((f) => f.projectId === "sodium")?.version.file.sha1,
    ).toBe("aa");
  });

  it("dedupes repeated project ids", async () => {
    const res = await resolveBulk(source, ["sodium", "sodium"], target);
    expect(res.found).toHaveLength(1);
  });

  it("treats a lookup error as no compatible version", async () => {
    const throwing = {
      ...source,
      getCompatibleVersion: () => Promise.reject(new Error("offline")),
    };
    const res = await resolveBulk(throwing, ["sodium"], target);
    expect(res.found).toHaveLength(0);
    expect(res.none.map((n) => n.projectId)).toEqual(["sodium"]);
  });
});
