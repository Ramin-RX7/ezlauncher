import { describe, expect, it } from "vitest";
import { resolveInstall, type LibraryView } from "./resolveDependencies";
import {
  createFakeModSource,
  type FakeVersionInput,
} from "./testing/fakeModSource";

const target = { gameVersion: "1.18.2", loaders: ["fabric"] };
const h = (c: string) => c.repeat(40);

function emptyLibrary(overrides: Partial<LibraryView> = {}): LibraryView {
  return {
    findUsable: () => undefined,
    enabledFromProject: () => [],
    hasFile: () => false,
    ...overrides,
  };
}

async function plan(
  versions: FakeVersionInput[],
  rootVersionId: string,
  library = emptyLibrary(),
) {
  const source = createFakeModSource(
    [
      { projectId: "sodium", name: "Sodium" },
      { projectId: "fabric-api", name: "Fabric API" },
      { projectId: "a", name: "A" },
      { projectId: "b", name: "B" },
      { projectId: "old", name: "Old" },
    ],
    versions,
  );
  const root = await source.getVersion(rootVersionId);
  return { plan: await resolveInstall(source, root, target, library), source };
}

const ids = (p: Awaited<ReturnType<typeof plan>>["plan"]) =>
  p.items.map((i) =>
    i.action === "download" ? i.version.versionId : `reuse:${i.projectId}`,
  );

describe("resolveInstall", () => {
  it("adds required dependencies and sums their size", async () => {
    const { plan: p } = await plan(
      [
        {
          projectId: "sodium",
          versionId: "s1",
          sha1: h("1"),
          size: 100,
          dependencies: [{ projectId: "fabric-api", kind: "required" }],
        },
        { projectId: "fabric-api", versionId: "f1", sha1: h("2"), size: 50 },
      ],
      "s1",
    );
    expect(ids(p)).toEqual(["s1", "f1"]);
    expect(p.totalSize).toBe(150);
    expect(p.missing).toEqual([]);
  });

  it("reuses a compatible mod from the library instead of downloading it", async () => {
    const { plan: p, source } = await plan(
      [
        {
          projectId: "sodium",
          versionId: "s1",
          sha1: h("1"),
          dependencies: [{ projectId: "fabric-api", kind: "required" }],
        },
        { projectId: "fabric-api", versionId: "f1", sha1: h("2") },
      ],
      "s1",
      emptyLibrary({
        findUsable: (_s, id) =>
          id === "fabric-api"
            ? { sha1: h("9"), name: "Fabric API" }
            : undefined,
      }),
    );
    expect(ids(p)).toEqual(["s1", "reuse:fabric-api"]);
    expect(source.calls).not.toContain("getCompatibleVersion fabric-api");
  });

  it("stops on dependency cycles", async () => {
    const { plan: p } = await plan(
      [
        {
          projectId: "a",
          versionId: "a1",
          sha1: h("a"),
          dependencies: [{ projectId: "b", kind: "required" }],
        },
        {
          projectId: "b",
          versionId: "b1",
          sha1: h("b"),
          dependencies: [{ projectId: "a", kind: "required" }],
        },
      ],
      "a1",
    );
    expect(ids(p)).toEqual(["a1", "b1"]);
  });

  it("reports a required dependency with no version for the profile", async () => {
    const { plan: p } = await plan(
      [
        {
          projectId: "sodium",
          versionId: "s1",
          sha1: h("1"),
          dependencies: [{ projectId: "fabric-api", kind: "required" }],
        },
        {
          projectId: "fabric-api",
          versionId: "f1",
          sha1: h("2"),
          gameVersions: ["1.20.1"],
        },
      ],
      "s1",
    );
    expect(p.missing).toEqual([{ projectId: "fabric-api" }]);
  });

  it("uses the exact version a dependency names", async () => {
    const { plan: p } = await plan(
      [
        {
          projectId: "sodium",
          versionId: "s1",
          sha1: h("1"),
          dependencies: [{ versionId: "f-old", kind: "required" }],
        },
        { projectId: "fabric-api", versionId: "f-new", sha1: h("3") },
        { projectId: "fabric-api", versionId: "f-old", sha1: h("2") },
      ],
      "s1",
    );
    expect(ids(p)).toEqual(["s1", "f-old"]);
  });

  it("ignores optional dependencies", async () => {
    const { plan: p } = await plan(
      [
        {
          projectId: "sodium",
          versionId: "s1",
          sha1: h("1"),
          dependencies: [{ projectId: "fabric-api", kind: "optional" }],
        },
        { projectId: "fabric-api", versionId: "f1", sha1: h("2") },
      ],
      "s1",
    );
    expect(ids(p)).toEqual(["s1"]);
  });

  it("warns about enabled mods it's incompatible with, and what it replaces", async () => {
    const { plan: p } = await plan(
      [
        {
          projectId: "sodium",
          versionId: "s2",
          sha1: h("2"),
          dependencies: [{ projectId: "old", kind: "incompatible" }],
        },
      ],
      "s2",
      emptyLibrary({
        enabledFromProject: (_s, id) =>
          id === "old"
            ? [{ sha1: h("o"), name: "Old" }]
            : id === "sodium"
              ? [{ sha1: h("1"), name: "Sodium 0.3" }]
              : [],
      }),
    );
    expect(p.incompatible).toEqual(["old"]);
    expect(p.replaces).toEqual([{ sha1: h("1"), name: "Sodium 0.3" }]);
  });

  it("counts files already stored as nothing to download", async () => {
    const { plan: p } = await plan(
      [{ projectId: "sodium", versionId: "s1", sha1: h("1"), size: 100 }],
      "s1",
      emptyLibrary({ hasFile: () => true }),
    );
    expect(p.totalSize).toBe(0);
  });
});
