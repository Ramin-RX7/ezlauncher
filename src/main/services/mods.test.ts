import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "@shared/launcher";
import { AppError } from "../core/errors";
import { createLogger } from "../core/logger";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import type { ModSourceRegistry } from "../modsources/registry";
import { createFakeModSource } from "../modsources/testing/fakeModSource";
import { createModLibrary } from "../profiles/mods";
import { fabricJar, fabricMod } from "../profiles/testing/modJars";
import { createModService } from "./mods";
import { createRuntime } from "./runtime";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-mods-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const profile = (id: string, gameVersion = "1.20.1"): Profile => ({
  id,
  name: id,
  gameVersion,
  loader: { id: "fabric" },
  createdAt: "2026-01-01T00:00:00.000Z",
});
const PROFILES: Record<string, Profile> = {
  p1: profile("p1"),
  old: profile("old", "1.16.5"),
};

/** A jar outside the data folder, as picked in a file dialog. */
async function picked(name: string, bytes: Uint8Array) {
  const folder = join(dir, "downloads");
  await mkdir(folder, { recursive: true });
  const path = join(folder, name);
  await writeFile(path, bytes);
  return path;
}

function setup() {
  const source = createFakeModSource([], []);
  const sources = {
    sources: [source],
    get: () => source,
  } as unknown as ModSourceRegistry;
  const runtime = createRuntime();
  const mods = createModLibrary({ paths });
  const service = createModService({
    paths,
    downloader: createDownloader({
      fetch: createFakeFetch().fetch,
      userAgent: "test",
    }),
    sources,
    mods,
    runtime,
    whenReady: () => Promise.resolve(),
    requireProfile: (id) => {
      const p = PROFILES[id];
      return p
        ? Promise.resolve(p)
        : Promise.reject(new AppError("PROFILE_NOT_FOUND", "gone"));
    },
    sync: () =>
      mods
        .sync({ profileIds: Object.keys(PROFILES), isRunning: () => false })
        .then(() => undefined),
    changed: () => undefined,
    manifestVersions: () => Promise.resolve(undefined),
    identifyPacks: () => Promise.resolve(false),
    downloadProgress: () => undefined,
    bulkProgress: () => undefined,
    logger: createLogger({ console: false }),
  });
  return { service, runtime, mods };
}

describe("createModService", () => {
  it("adds picked jars, enabling only the ones that fit the profile", async () => {
    const { service } = setup();
    const fits = fabricMod("sodium", "0.5.0", ">=1.20");
    const tooNew = fabricMod("newer", "1.0.0", ">=1.21");
    const result = await service.api.addMods(
      [
        await picked("sodium.jar", fits),
        await picked("newer.jar", tooNew),
        await picked("notes.txt", fits),
        "relative.jar",
      ],
      "p1",
    );
    expect(result.added).toBe(2);
    expect(result.failed).toEqual([
      { fileName: "notes.txt", code: "NOT_A_JAR" },
      { fileName: "relative.jar", code: "NOT_A_JAR" },
      { fileName: "newer.jar", code: "MOD_INCOMPATIBLE" },
    ]);
    expect(await readdir(paths.modsDir("p1"))).toHaveLength(1);
    expect(await service.hasMod("p1", "sodium")).toBe(true);
    expect(await service.hasMod("p1", "newer")).toBe(false);
  });

  it("finds a mod by what a mod provides or carries inside it", async () => {
    const { service } = setup();
    const bundle = fabricJar(
      {
        schemaVersion: 1,
        id: "bundle",
        version: "1.0.0",
        provides: ["iris"],
        depends: { minecraft: ">=1.18" },
      },
      {},
    );
    await service.api.addMods([await picked("bundle.jar", bundle)], "p1");
    expect(await service.hasMod("p1", "iris")).toBe(true);
    expect(await service.hasMod("old", "iris")).toBe(false);
  });

  it("keeps a profile's mods as they are while it plays", async () => {
    const { service, runtime } = setup();
    const jar = fabricMod("sodium", "0.5.0");
    runtime.starting.add("p1:a1");
    const result = await service.api.addMods(
      [await picked("sodium.jar", jar)],
      "p1",
    );
    expect(result.failed).toEqual([]);
    runtime.running.set("l1", {
      launchId: "l1",
      profileId: "p1",
      accountId: "a1",
      versionId: "1.20.1",
      pid: 1,
    });
    const again = await service.api.addMods(
      [await picked("lithium.jar", fabricMod("lithium", "0.11.0"))],
      "p1",
    );
    expect(again.failed).toEqual([
      { fileName: "lithium.jar", code: "GAME_RUNNING" },
    ]);
    await expect(
      service.api.setModEnabled("p1", sha1(jar), false),
    ).rejects.toMatchObject({ code: "GAME_RUNNING" });
  });

  it("asks before deleting a mod that profiles use", async () => {
    const { service, mods } = setup();
    const jar = fabricMod("sodium", "0.5.0");
    await service.api.addMods([await picked("sodium.jar", jar)], "p1");
    await expect(service.api.removeMod(sha1(jar), false)).rejects.toMatchObject(
      { code: "MOD_IN_USE" },
    );
    await service.api.removeMod(sha1(jar), true);
    expect(await mods.list()).toEqual([]);
  });

  it("doesn't look up mods for vanilla profiles, nor offer them updates", async () => {
    const { service } = setup();
    PROFILES.vanilla = { ...profile("vanilla"), loader: null };
    try {
      await expect(
        service.api.findRemoteMods("vanilla", "sodium"),
      ).rejects.toMatchObject({ code: "MOD_INCOMPATIBLE" });
      await expect(
        service.api.checkModUpdates("vanilla"),
      ).rejects.toMatchObject({ code: "MOD_INCOMPATIBLE" });
      expect(service.isBusy()).toBe(false);
    } finally {
      delete PROFILES.vanilla;
    }
  });
});
