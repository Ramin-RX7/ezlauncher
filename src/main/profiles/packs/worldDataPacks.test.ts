import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPaths, type Paths } from "../../minecraft/paths";
import { sameFile } from "../links";
import { makeLevelDat } from "../testing/levelDat";
import { createPackLibrary, dataPackKind, type PackLibrary } from "./library";
import { createWorldDataPacks } from "./worldDataPacks";

let dir: string;
let paths: Paths;
let library: PackLibrary;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-datapacks-"));
  paths = createPaths(dir);
  library = createPackLibrary({ paths, kind: dataPackKind(paths) });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** World ids are folder names, so they can have spaces and brackets. */
const W = "New World (1)";
const V = "Other";
const FORMAT = { major: 48, minor: 0 };
const world = (id = W) => ({ id, format: FORMAT, unsupported: false });
const packs = () => createWorldDataPacks({ paths, library });
const syncAll = () =>
  library.sync({ profileIds: [W, V], isRunning: () => false });

function dataZip(description: string, extra: object = {}) {
  return zipSync({
    "pack.mcmeta": strToU8(
      JSON.stringify({ pack: { pack_format: 48, description }, ...extra }),
    ),
    "data/x/function/a.mcfunction": strToU8("say hi"),
  });
}

async function addPack(name: string, extra: object = {}) {
  await mkdir(join(dir, "downloads"), { recursive: true });
  const path = join(dir, "downloads", name);
  await writeFile(path, dataZip(name, extra));
  const [result] = await library.add([path]);
  if (!result?.ok) throw new Error("not added");
  return result.sha1;
}

async function makeWorld(
  id: string,
  dataPacks?: Parameters<typeof makeLevelDat>[2],
) {
  await mkdir(paths.worldDir(id), { recursive: true });
  await writeFile(paths.worldLevelDat(id), makeLevelDat(id, 1, dataPacks));
}

describe("world data packs", () => {
  it("adds a library pack to two worlds, stored once", async () => {
    await makeWorld(W);
    await makeWorld(V);
    const sha1 = await addPack("Terralith.zip");
    await packs().add(W, sha1);
    await packs().add(V, sha1);
    expect(
      await sameFile(
        join(paths.worldDataPacksDir(W), "Terralith.zip"),
        join(paths.worldDataPacksDir(V), "Terralith.zip"),
      ),
    ).toBe(true);
    const view = await packs().view(world(), { running: false });
    expect(view.inWorld).toMatchObject([
      { name: "Terralith", compat: "compatible", offInGame: false },
    ]);
    expect(view.available).toEqual([]);
    expect(await library.usedBy(sha1)).toEqual([W, V]);
  });

  it("shows packs turned off in game and ones missing experimental features", async () => {
    await makeWorld(W, {
      enabled: ["vanilla"],
      disabled: ["file/Off.zip"],
    });
    const off = await addPack("Off.zip");
    const bundle = await addPack("Bundle.zip", {
      features: { enabled: ["minecraft:bundle"] },
    });
    await packs().add(W, off);
    await packs().add(W, bundle);
    const view = await packs().view(world(), { running: false });
    expect(view.inWorld).toMatchObject([
      {
        name: "Bundle",
        offInGame: false,
        missingFeatures: ["minecraft:bundle"],
      },
      { name: "Off", offInGame: true, missingFeatures: [] },
    ]);
  });

  it("adopts zips dropped in by hand, lists folders, and flags non-packs", async () => {
    await makeWorld(W);
    const dp = paths.worldDataPacksDir(W);
    await mkdir(join(dp, "Folder pack", "data"), { recursive: true });
    await writeFile(
      join(dp, "Folder pack", "pack.mcmeta"),
      JSON.stringify({ pack: { pack_format: 99 } }),
    );
    await writeFile(join(dp, "Dropped.zip"), dataZip("dropped"));
    await writeFile(
      join(dp, "Textures.zip"),
      zipSync({
        "pack.mcmeta": strToU8('{"pack":{"pack_format":15}}'),
        "assets/a.png": strToU8("x"),
      }),
    );
    const { adopted } = await syncAll();
    expect(adopted).toBe(1);
    const view = await packs().view(world(), { running: false });
    expect(view.inWorld.map((p) => [p.name, p.compat])).toEqual([
      ["Dropped", "compatible"],
      ["Folder pack", "tooNew"],
    ]);
    expect(view.notPacks).toEqual([
      { name: "Textures.zip", reason: "invalid" },
    ]);
  });

  it("removes a pack from a world only", async () => {
    await makeWorld(W);
    const sha1 = await addPack("A.zip");
    await packs().add(W, sha1);
    await packs().remove(W, sha1);
    const view = await packs().view(world(), { running: false });
    expect(view.inWorld).toEqual([]);
    expect(view.available).toHaveLength(1);
  });

  it("forgets a deleted world's packs on sync", async () => {
    await makeWorld(W);
    const sha1 = await addPack("A.zip");
    await packs().add(W, sha1);
    await rm(paths.worldDir(W), { recursive: true });
    await library.sync({ profileIds: [V], isRunning: () => false });
    expect(await library.usedBy(sha1)).toEqual([]);
  });

  it("locks old versions and running worlds", async () => {
    await makeWorld(W);
    expect(
      (
        await packs().view(
          { ...world(), unsupported: true },
          { running: false },
        )
      ).locked,
    ).toBe("unsupported");
    expect((await packs().view(world(), { running: true })).locked).toBe(
      "running",
    );
  });
});
