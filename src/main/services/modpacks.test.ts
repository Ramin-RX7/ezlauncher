import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModpackProgress } from "@shared/launcher";
import { createLogger } from "../core/logger";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { readManifest } from "../modpacks/manifest";
import {
  packIndex,
  packRoutes,
  writeMrpack,
  type FakePackFile,
} from "../modpacks/testing/makeMrpack";
import { createFakeModSource } from "../modsources/testing/fakeModSource";
import { createProfileStore } from "../profiles/profiles";
import { createModpackService } from "./modpacks";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-modpacks-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const V1: FakePackFile[] = [
  { path: "mods/a.jar", body: "a1" },
  { path: "mods/map.jar", body: "map", env: { client: "optional" } },
];
const V2: FakePackFile[] = [
  {
    path: "mods/a.jar",
    body: "a2",
    url: "https://cdn.modrinth.com/data/test/v2/a.jar",
  },
];

async function setup() {
  const v1 = join(dir, "v1.mrpack");
  const v2 = join(dir, "v2.mrpack");
  await writeMrpack(v1, packIndex({ files: V1 }), {
    "overrides/config/a.json": "v1",
  });
  await writeMrpack(v2, packIndex({ files: V2, versionId: "2.0.0" }), {
    "overrides/config/a.json": "v2",
  });
  const v2Bytes = await readFile(v2);
  const fake = createFakeFetch({
    ...packRoutes(V1),
    ...packRoutes(V2),
    "https://fake/files/v2.mrpack": v2Bytes,
  });
  const source = createFakeModSource(
    [{ projectId: "pack", name: "Pack", projectType: "modpack" }],
    [
      {
        projectId: "pack",
        versionId: "pv2",
        versionNumber: "2.0.0",
        sha1: sha1(v2Bytes),
        size: v2Bytes.length,
        url: "https://fake/files/v2.mrpack",
        fileName: "pack-2.0.0.mrpack",
      },
    ],
  );
  const profiles = createProfileStore(paths.launcherFile("profiles.json"));
  const progress: ModpackProgress[] = [];
  const synced: string[][] = [];
  const busy = new Set<string>();
  const service = createModpackService({
    paths,
    downloader: createDownloader({
      fetch: fake.fetch,
      userAgent: "t",
      retries: 0,
    }),
    profiles,
    sources: {
      sources: [source],
      get: () => source,
    },
    requireProfile: async (id) => {
      const p = await profiles.get(id);
      if (!p) throw new Error("no profile");
      return p;
    },
    assertNotRunning: () => undefined,
    busy,
    serialFs: (fn) => fn(),
    sync: (only) => {
      synced.push(only);
      return Promise.resolve();
    },
    forgetProfile: () => Promise.resolve(),
    loaderVersionOf: () => Promise.resolve(undefined),
    fetchImage: () => Promise.resolve(undefined),
    progress: (p) => progress.push(p),
    changed: () => undefined,
    logger: createLogger({ console: false }),
  });
  return { service, profiles, fake, v1, synced, progress };
}

describe("mod pack service", () => {
  it("imports a pack as a new profile with its pinned loader", async () => {
    const { service, synced, v1 } = await setup();
    const preview = await service.inspectFile(v1);
    expect(preview).toMatchObject({
      name: "Test Pack",
      gameVersion: "1.20.1",
      loader: "fabric",
      loaderVersion: "0.16.0",
      supported: true,
      files: 2,
      included: 1,
      optional: [{ path: "mods/map.jar", size: 3 }],
    });
    const profile = await service.importPack({
      token: preview.token,
      name: "  My pack  ",
      skip: ["mods/map.jar"],
    });
    expect(profile).toMatchObject({
      name: "My pack",
      gameVersion: "1.20.1",
      loader: { id: "fabric", version: "0.16.0" },
      modpack: { name: "Test Pack", versionNumber: "1.0.0" },
    });
    const game = paths.gameDir(profile.id);
    expect(await readFile(join(game, "mods", "a.jar"), "utf8")).toBe("a1");
    await expect(stat(join(game, "mods", "map.jar"))).rejects.toThrow();
    expect(synced).toEqual([[profile.id]]);
    expect((await readManifest(paths, profile.id))?.skipped).toEqual([
      "mods/map.jar",
    ]);
    // The same pack can be imported again: a second, separate profile.
    const again = await service.importPack({
      token: (await service.inspectFile(v1)).token,
      name: "Again",
      skip: [],
    });
    expect(again.id).not.toBe(profile.id);
  });

  it("leaves nothing behind when an import fails", async () => {
    const { service, profiles, fake, v1 } = await setup();
    const preview = await service.inspectFile(v1);
    fake.setOffline(true);
    await expect(
      service.importPack({ token: preview.token, name: "x", skip: [] }),
    ).rejects.toMatchObject({ code: "OFFLINE" });
    expect(await profiles.list()).toEqual([]);
    expect(await readdir(paths.profilesDir).catch(() => [])).toEqual([]);
  });

  it("refuses Forge packs", async () => {
    const { service } = await setup();
    const forge = join(dir, "forge.mrpack");
    await writeMrpack(
      forge,
      packIndex({ dependencies: { minecraft: "1.20.1", forge: "47.2.0" } }),
    );
    const preview = await service.inspectFile(forge);
    expect(preview.supported).toBe(false);
    await expect(
      service.importPack({ token: preview.token, name: "x", skip: [] }),
    ).rejects.toMatchObject({ code: "MODPACK_LOADER_UNSUPPORTED" });
  });

  it("updates a pack profile to a site version, keeping the user's changes", async () => {
    const { service, profiles, v1 } = await setup();
    const preview = await service.inspectFile(v1);
    const imported = await service.importPack({
      token: preview.token,
      name: "P",
      skip: [],
    });
    // It came from the site (as if imported from there).
    await profiles.setPack(imported.id, {
      modpack: {
        name: "Test Pack",
        versionNumber: "1.0.0",
        sourceId: "fake",
        projectId: "pack",
      },
    });
    const game = paths.gameDir(imported.id);
    await writeFile(join(game, "config", "a.json"), "mine");

    expect(
      (await service.updateVersions(imported.id)).map((v) => v.versionId),
    ).toEqual(["pv2"]);
    const plan = await service.planUpdate({
      profileId: imported.id,
      versionId: "pv2",
    });
    expect(plan).toMatchObject({ from: "1.0.0", to: "2.0.0", supported: true });
    expect(
      Object.fromEntries(plan.items.map((i) => [i.path, i.action])),
    ).toEqual({
      "config/a.json": "changed",
      "mods/a.jar": "update",
      // It was optional and kept; v2 dropped it.
      "mods/map.jar": "remove",
    });
    const result = await service.applyUpdate({
      token: plan.token,
      replace: [],
    });
    expect(result).toMatchObject({ added: 0, updated: 1, removed: 1 });
    expect(await readFile(join(game, "mods", "a.jar"), "utf8")).toBe("a2");
    expect(await readFile(join(game, "config", "a.json"), "utf8")).toBe("mine");
    expect((await profiles.get(imported.id))?.modpack).toMatchObject({
      versionNumber: "2.0.0",
      versionId: "pv2",
    });
    expect((await readManifest(paths, imported.id))?.versionNumber).toBe(
      "2.0.0",
    );
    // The staging folder is gone.
    expect(
      (await readdir(paths.profilesDir)).filter((n) => n.startsWith(".")),
    ).toEqual([]);
  });

  it("gives a duplicate the pack record and the pack's config files", async () => {
    const { service, profiles, v1 } = await setup();
    const preview = await service.inspectFile(v1);
    const src = await service.importPack({
      token: preview.token,
      name: "P",
      skip: [],
    });
    const copy = await profiles.create({
      name: "P (copy)",
      gameVersion: src.gameVersion,
      loader: src.loader,
    });
    await service.copyTo(src, copy);
    expect(
      await readFile(join(paths.gameDir(copy.id), "config", "a.json"), "utf8"),
    ).toBe("v1");
    // Library files (mods) are left to the library.
    await expect(
      stat(join(paths.gameDir(copy.id), "mods", "a.jar")),
    ).rejects.toThrow();
    expect((await profiles.get(copy.id))?.modpack?.name).toBe("Test Pack");
    expect(await readManifest(paths, copy.id)).toEqual(
      await readManifest(paths, src.id),
    );
  });
});
