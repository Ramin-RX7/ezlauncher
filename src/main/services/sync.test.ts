import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../core/logger";
import { createPaths, type Paths } from "../minecraft/paths";
import { sha1 } from "../minecraft/testing/fakeFetch";
import { createModLibrary } from "../profiles/mods";
import {
  createPackLibrary,
  dataPackKind,
  shaderPackKind,
} from "../profiles/packs/library";
import { createProfilePacks } from "../profiles/packs/profilePacks";
import { createProfileShaders } from "../profiles/packs/profileShaders";
import { createProfileStore } from "../profiles/profiles";
import { fabricMod } from "../profiles/testing/modJars";
import { listWorlds, readWorldOwner } from "../profiles/worlds";
import { createRuntime } from "./runtime";
import { createSync } from "./sync";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-sync-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const dataPack = zipSync({
  "pack.mcmeta": strToU8(
    JSON.stringify({ pack: { pack_format: 48, description: "More ores" } }),
  ),
  "data/x/function/a.mcfunction": strToU8("say hi"),
});

async function setup() {
  const runtime = createRuntime();
  const profiles = createProfileStore(paths.launcherFile("profiles.json"));
  const mods = createModLibrary({ paths });
  const packs = createPackLibrary({ paths });
  const shaders = createPackLibrary({ paths, kind: shaderPackKind(paths) });
  const dataPacks = createPackLibrary({ paths, kind: dataPackKind(paths) });
  const onAdopted = vi.fn();
  const { sync } = createSync({
    paths,
    profiles,
    mods,
    packs,
    shaders,
    dataPacks,
    profilePacks: createProfilePacks({
      paths,
      library: packs,
      gameFormat: () => Promise.resolve(undefined),
    }),
    profileShaders: createProfileShaders({ paths, library: shaders }),
    runtime,
    onAdopted,
    logger: createLogger({ console: false }),
  });
  const profile = await profiles.create({
    name: "Survival",
    gameVersion: "1.21.4",
    loader: { id: "fabric" },
  });
  return { sync, runtime, mods, dataPacks, onAdopted, id: profile.id };
}

/** A world the game made in the profile's `saves/`. */
async function madeInGame(profileId: string, name: string) {
  const save = join(paths.gameDir(profileId), "saves", name);
  await mkdir(save, { recursive: true });
  await writeFile(join(save, "level.dat"), "level");
}

describe("createSync", () => {
  it("adopts a world made in game into worlds/, owned by its profile", async () => {
    const { sync, id } = await setup();
    await madeInGame(id, "New World");
    await sync();
    expect(await readdir(paths.worldsDir)).toEqual(["New World"]);
    expect(await readWorldOwner(paths, "New World")).toBe(id);
    expect(await listWorlds(paths, id)).toEqual([
      expect.objectContaining({ id: "New World", linked: true }),
    ]);
  });

  it("adopts a mod dropped into the profile, and asks to identify it", async () => {
    const { sync, mods, onAdopted, id } = await setup();
    const jar = fabricMod("sodium", "0.6.0");
    await mkdir(paths.modsDir(id), { recursive: true });
    await writeFile(join(paths.modsDir(id), "sodium.jar"), jar);
    await sync([id]);
    expect((await mods.list()).map((m) => m.sha1)).toEqual([sha1(jar)]);
    expect(onAdopted).toHaveBeenCalled();
  });

  it("adopts a data pack dropped into a world, keyed by the world", async () => {
    const { sync, dataPacks, id } = await setup();
    await madeInGame(id, "Home");
    await sync();
    await mkdir(paths.worldDataPacksDir("Home"), { recursive: true });
    await writeFile(
      join(paths.worldDataPacksDir("Home"), "ores.zip"),
      dataPack,
    );
    await sync([id]);
    expect(await dataPacks.usedBy(sha1(dataPack))).toEqual(["Home"]);
  });

  it("leaves a profile alone while it plays", async () => {
    const { sync, runtime, mods, id } = await setup();
    await madeInGame(id, "New World");
    await mkdir(paths.modsDir(id), { recursive: true });
    await writeFile(
      join(paths.modsDir(id), "sodium.jar"),
      fabricMod("sodium", "0.6.0"),
    );
    runtime.running.set("l1", {
      launchId: "l1",
      profileId: id,
      accountId: "a1",
      versionId: "1.21.4",
      pid: 1,
    });
    await sync();
    expect(await readdir(paths.worldsDir).catch(() => [])).toEqual([]);
    expect(await mods.list()).toEqual([]);
  });
});
