import { describe, expect, it } from "vitest";
import { describePlan, projectCard, projectsToName } from "./remoteCard";
import type { InstallPlan } from "./resolveDependencies";
import type { RemoteVersion } from "./types";

const version = (projectId: string, fileName: string): RemoteVersion => ({
  sourceId: "modrinth",
  projectId,
  versionId: `${projectId}-v`,
  versionNumber: "1.0.0",
  channel: "release",
  loaders: ["fabric"],
  gameVersions: ["1.21.4"],
  file: { url: "https://x", fileName, size: 10, sha1: "a" },
  dependencies: [],
});

const sodium = version("sodium", "sodium-1.0.0.jar");
const plan: InstallPlan = {
  sourceId: "modrinth",
  items: [
    { action: "download", version: sodium, root: true },
    {
      action: "download",
      version: version("api", "api-1.0.0.jar"),
      root: false,
    },
    { action: "download", version: version("libx", "libx.jar"), root: false },
    { action: "reuse", projectId: "fabric-api", sha1: "b", name: "Fabric API" },
  ],
  missing: [{ projectId: "gone" }, { versionId: "v-only" }],
  incompatible: ["optifabric"],
  replaces: [{ sha1: "c", name: "Sodium 0.5" }],
  totalSize: 30,
};

describe("remote mod cards", () => {
  it("starts a card from a search hit, with nothing known yet", () => {
    const card = projectCard("modrinth", {
      sourceId: "modrinth",
      projectId: "sodium",
      slug: "sodium",
      name: "Sodium",
      author: "jellysquid",
      pageUrl: "https://modrinth.com/mod/sodium",
      downloads: 5,
    });
    expect(card).toEqual({
      sourceId: "modrinth",
      project: {
        projectId: "sodium",
        name: "Sodium",
        author: "jellysquid",
        pageUrl: "https://modrinth.com/mod/sodium",
        downloads: 5,
      },
      version: null,
      dependencies: [],
      missing: [],
      incompatible: [],
      replaces: [],
      totalSize: 0,
    });
  });

  it("names new dependencies and missing ones, not the mod itself", () => {
    expect(projectsToName(plan)).toEqual(["api", "libx", "gone"]);
  });

  it("words a plan, falling back to file names and ids", () => {
    const names = new Map([
      ["api", "Some API"],
      ["gone", "Gone Lib"],
    ]);
    expect(describePlan(sodium, plan, names, ["OptiFabric"])).toEqual({
      version: { versionNumber: "1.0.0", fileName: "sodium-1.0.0.jar" },
      dependencies: [
        { name: "Some API", versionNumber: "1.0.0", action: "download" },
        { name: "libx.jar", versionNumber: "1.0.0", action: "download" },
        { name: "Fabric API", action: "reuse" },
      ],
      missing: ["Gone Lib", "v-only"],
      incompatible: ["OptiFabric"],
      replaces: ["Sodium 0.5"],
      totalSize: 30,
    });
  });
});
