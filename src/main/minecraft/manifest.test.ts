import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../core/fsAtomic";
import { createDownloader } from "./downloader";
import { getVersionList, MANIFEST_URL } from "./manifest";
import { createPaths, type Paths } from "./paths";
import { createFakeFetch } from "./testing/fakeFetch";

const manifest = (release: string) => ({
  latest: { release, snapshot: release },
  versions: [
    {
      id: release,
      type: "release",
      url: "u2",
      time: "t",
      releaseTime: "2026-02-01T00:00:00+00:00",
    },
    {
      id: "1.0",
      type: "release",
      url: "u1",
      time: "t",
      releaseTime: "2011-11-18T00:00:00+00:00",
    },
  ],
});

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-manifest-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(release = "2.0") {
  const fake = createFakeFetch({
    [MANIFEST_URL]: JSON.stringify(manifest(release)),
  });
  const downloader = createDownloader({
    fetch: fake.fetch,
    userAgent: "t",
    retries: 0,
  });
  return { fake, deps: { paths, downloader } };
}

describe("getVersionList", () => {
  it("fetches once when there is no saved list, then uses the saved list with no requests", async () => {
    const { fake, deps } = setup();
    const first = await getVersionList(deps);
    expect(first.source).toBe("online");
    expect(first.versions.map((v) => v.id)).toEqual(["2.0", "1.0"]);
    expect(fake.requests).toHaveLength(1);

    const second = await getVersionList(deps);
    expect(second.source).toBe("cache");
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(fake.requests).toHaveLength(1);
  });

  it("refreshes only when asked", async () => {
    const { fake, deps } = setup();
    await getVersionList(deps);
    fake.routes[MANIFEST_URL] = JSON.stringify(manifest("3.0"));
    const refreshed = await getVersionList(deps, { refresh: true });
    expect(refreshed.source).toBe("online");
    expect(refreshed.latest?.release).toBe("3.0");
    expect(fake.requests).toHaveLength(2);
  });

  it("keeps the saved list when a refresh fails", async () => {
    const { fake, deps } = setup();
    await getVersionList(deps);
    fake.setOffline(true);
    const result = await getVersionList(deps, { refresh: true });
    expect(result.source).toBe("cache");
    expect(result.refreshError).toBe("OFFLINE");
    expect(result.versions).toHaveLength(2);
  });

  it("shows installed versions even with no list and no network", async () => {
    const { fake, deps } = setup();
    fake.setOffline(true);
    await writeJsonAtomic(paths.versionJson("1.8.9"), {
      id: "1.8.9",
      type: "release",
      releaseTime: "2015-12-03T09:24:39+00:00",
    });
    await writeJsonAtomic(paths.installMarker("1.8.9"), {
      schema: 1,
      versionId: "1.8.9",
      installedAt: "now",
    });
    const result = await getVersionList(deps);
    expect(result.source).toBe("none");
    expect(result.versions).toEqual([
      {
        id: "1.8.9",
        type: "release",
        releaseTime: "2015-12-03T09:24:39+00:00",
        installed: true,
      },
    ]);
  });

  it("marks installed versions in the manifest", async () => {
    const { deps } = setup();
    await writeJsonAtomic(paths.installMarker("1.0"), {
      schema: 1,
      versionId: "1.0",
      installedAt: "now",
    });
    const result = await getVersionList(deps);
    expect(result.versions.find((v) => v.id === "1.0")?.installed).toBe(true);
    expect(result.versions.find((v) => v.id === "2.0")?.installed).toBe(false);
  });
});
