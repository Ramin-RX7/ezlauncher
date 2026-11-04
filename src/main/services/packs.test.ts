import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackDownloadProgress } from "@shared/launcher";
import { AppError } from "../core/errors";
import { createLogger } from "../core/logger";
import { createDownloader, type FetchFn } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { RESOURCE_PACK_DOWNLOAD } from "../modsources/downloadPack";
import type { ModSourceRegistry } from "../modsources/registry";
import { createFakeModSource } from "../modsources/testing/fakeModSource";
import { createPackLibrary, type PackLibrary } from "../profiles/packs/library";
import { createProfileStore } from "../profiles/profiles";
import { createPackKindService, type PackKind } from "./packs";
import { createRuntime } from "./runtime";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-packs-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const packZip = (description: string) =>
  zipSync({
    "pack.mcmeta": strToU8(
      JSON.stringify({ pack: { pack_format: 15, description } }),
    ),
  });
const fresh = packZip("Fresh");

interface Target {
  id: string;
  gameVersion: string;
}

function setup(
  overrides: Partial<PackKind<Target, unknown>> & { fetch?: FetchFn } = {},
) {
  const files = createFakeFetch({ "https://fake/fresh.zip": fresh });
  const source = createFakeModSource(
    [{ projectId: "fresh", name: "Fresh", projectType: "resourcepack" }],
    [
      {
        projectId: "fresh",
        versionId: "v1",
        loaders: ["minecraft"],
        gameVersions: ["1.20.1"],
        sha1: sha1(fresh),
        size: fresh.length,
        url: "https://fake/fresh.zip",
        fileName: "Fresh_v1.zip",
      },
    ],
  );
  const sources = {
    sources: [source],
    get: () => source,
  } as unknown as ModSourceRegistry;
  const runtime = createRuntime();
  const library = createPackLibrary({ paths });
  const placed: { target: string; sha1s: string[] }[] = [];
  const progress: PackDownloadProgress[] = [];
  const changed = vi.fn();
  const service = createPackKindService<Target, unknown>(
    {
      paths,
      downloader: createDownloader({
        fetch: overrides.fetch ?? files.fetch,
        userAgent: "test",
      }),
      sources,
      profiles: createProfileStore(paths.launcherFile("profiles.json")),
      runtime,
      whenReady: () => Promise.resolve(),
      requireProfile: () => Promise.reject(new Error("not used")),
      sync: () => Promise.resolve(),
      changed,
      fetchImage: () => Promise.resolve(undefined),
      logger: createLogger({ console: false }),
    },
    {
      library,
      download: RESOURCE_PACK_DOWNLOAD,
      inUse: { code: "PACK_IN_USE", message: "in use" },
      busyMessage: "already downloading",
      target: (id) =>
        id === "missing"
          ? Promise.reject(new AppError("PROFILE_NOT_FOUND", "gone"))
          : Promise.resolve({ id, gameVersion: "1.20.1" }),
      gameVersion: (t) => t.gameVersion,
      progress: (p) => progress.push(p),
      projectIcon: false,
      addTo: (target, sha1s) => {
        placed.push({ target: target.id, sha1s });
        return Promise.resolve();
      },
      assertUsersIdle: (users) => {
        for (const id of users) runtime.assertNotRunning(id);
        return Promise.resolve();
      },
      result: (installed) => Promise.resolve(installed),
      ...overrides,
    },
  );
  return { service, library, runtime, placed, progress, changed };
}

/** The library, but saying these profiles have every pack. */
function usedBy(library: PackLibrary, users: string[]): PackLibrary {
  return { ...library, usedBy: () => Promise.resolve(users) };
}

describe("createPackKindService", () => {
  it("downloads into the library, puts it in the target, and words the result", async () => {
    const { service, library, placed, progress, changed } = setup();
    const result = await service.install("fake", "fresh", "p1");
    expect(result).toMatchObject({
      placed: true,
      target: { id: "p1" },
      base: {
        sha1: sha1(fresh),
        name: "Fresh_v1",
        otherVersion: false,
      },
    });
    expect(placed).toEqual([{ target: "p1", sha1s: [sha1(fresh)] }]);
    expect((await library.list()).map((p) => p.sha1)).toEqual([sha1(fresh)]);
    expect(progress.at(-1)).toMatchObject({ projectId: "fresh" });
    expect(changed).toHaveBeenCalled();
    expect(service.isBusy()).toBe(false);
  });

  it("keeps a download that can't be put in its target", async () => {
    const { service, library } = setup({
      addTo: () => Promise.reject(new AppError("GAME_RUNNING", "playing")),
    });
    const result = await service.install("fake", "fresh", "p1");
    expect(result).toMatchObject({ placed: false });
    expect(await library.list()).toHaveLength(1);
  });

  it("refuses a second download of the same project, and cancels one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const files = createFakeFetch({ "https://fake/fresh.zip": fresh });
    const { service } = setup({
      fetch: async (url, init) => {
        await gate;
        return files.fetch(url, init);
      },
    });
    const first = service.install("fake", "fresh");
    await vi.waitFor(() => {
      expect(service.isBusy()).toBe(true);
    });
    await expect(service.install("fake", "fresh")).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(service.cancelInstall("fresh")).toBe(true);
    release();
    await expect(first).rejects.toBeDefined();
    expect(service.isBusy()).toBe(false);
    expect(service.cancelInstall("fresh")).toBe(false);
  });

  it("reports picked paths that aren't pack zips, and target failures per stored file", async () => {
    const zip = join(dir, "Fresh.zip");
    await writeFile(zip, fresh);
    const { service } = setup({
      addTo: () => Promise.reject(new AppError("GAME_RUNNING", "playing")),
    });
    const result = await service.add(
      [zip, join(dir, "missing.zip"), "relative.zip", 42],
      "p1",
    );
    expect(result.added).toBe(1);
    expect(result.failed).toEqual([
      { fileName: "missing.zip", code: "NOT_A_PACK" },
      { fileName: "relative.zip", code: "NOT_A_PACK" },
      { fileName: "?", code: "NOT_A_PACK" },
      { fileName: "Fresh.zip", code: "GAME_RUNNING" },
    ]);
  });

  it("checks the target before adding anything", async () => {
    const zip = join(dir, "Fresh.zip");
    await writeFile(zip, fresh);
    const { service, library } = setup();
    await expect(service.add([zip], "missing")).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
    expect(await library.list()).toEqual([]);
  });

  it("removes a pack in use only with force, and never while a user plays", async () => {
    const zip = join(dir, "Fresh.zip");
    await writeFile(zip, fresh);
    const base = setup();
    await base.service.add([zip]);
    const beforeRemove = vi.fn(() => Promise.resolve());
    const { service, runtime } = setup({
      library: usedBy(base.library, ["p1"]),
      beforeRemove,
    });

    await expect(service.remove(sha1(fresh), false)).rejects.toMatchObject({
      code: "PACK_IN_USE",
    });
    runtime.starting.add("p1:a1");
    await expect(service.remove(sha1(fresh), true)).rejects.toMatchObject({
      code: "GAME_RUNNING",
    });
    expect(beforeRemove).not.toHaveBeenCalled();

    runtime.starting.clear();
    await service.remove(sha1(fresh), true);
    expect(beforeRemove).toHaveBeenCalledWith(["p1"], sha1(fresh));
    expect(await base.library.list()).toEqual([]);
  });

  it("searches for the target's Minecraft version", async () => {
    const { service } = setup();
    const page = await service.search("fresh", "p1", 0);
    expect(page.hits.map((h) => h.projectId)).toEqual(["fresh"]);
  });
});
