import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { importPackFiles } from "./importPack";
import type { PackManifest } from "./manifest";
import { readMrpack } from "./readMrpack";
import {
  packIndex,
  packRoutes,
  writeMrpack,
  type FakePackFile,
} from "./testing/makeMrpack";
import { applyUpdate, planUpdate } from "./updatePack";

let dir: string;
let paths: Paths;
let game: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-update-"));
  paths = createPaths(dir);
  game = join(dir, "game");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const V1: FakePackFile[] = [
  { path: "mods/keep.jar", body: "keep" },
  { path: "mods/old.jar", body: "old" },
  { path: "mods/sodium-1.jar", body: "sodium1" },
];
const V2: FakePackFile[] = [
  { path: "mods/keep.jar", body: "keep" },
  { path: "mods/sodium-2.jar", body: "sodium2" },
];

async function pack(
  name: string,
  files: FakePackFile[],
  overrides: Record<string, string>,
) {
  const file = join(dir, name);
  await writeMrpack(file, packIndex({ files }), overrides);
  return file;
}

async function setup() {
  const fake = createFakeFetch({ ...packRoutes(V1), ...packRoutes(V2) });
  const deps = {
    paths,
    downloader: createDownloader({
      fetch: fake.fetch,
      userAgent: "t",
      retries: 0,
    }),
  };
  const v1 = await pack("v1.mrpack", V1, {
    "overrides/config/same.json": "same",
    "overrides/config/edited.json": "v1",
    "overrides/config/untouched.json": "v1",
    "overrides/config/gone.json": "gone",
    "overrides/config/gone-edited.json": "gone",
    "overrides/options.txt": "fov:1",
  });
  const v2 = await pack("v2.mrpack", V2, {
    "overrides/config/same.json": "same",
    "overrides/config/edited.json": "v2",
    "overrides/config/untouched.json": "v2",
    "overrides/config/new.json": "new",
    "overrides/options.txt": "fov:2",
    "overrides/saves/Pack World/level.dat": "world",
  });
  const imported = await importPackFiles(deps, {
    file: v1,
    contents: await readMrpack(v1),
    gameDir: game,
    skip: new Set(),
  });
  const manifest: PackManifest = {
    schema: 1,
    name: "Test Pack",
    versionNumber: "1.0.0",
    ...imported,
  };
  // The user plays: edits two configs, the game rewrites options.txt, adds a mod.
  await writeFile(join(game, "config", "edited.json"), "mine");
  await writeFile(join(game, "config", "gone-edited.json"), "mine");
  await writeFile(join(game, "options.txt"), "fov:1\ngamma:5");
  await writeFile(join(game, "mods", "mine.jar"), "mine");
  return { deps, v2, manifest };
}

describe("planUpdate", () => {
  it("sorts every change by whose file it is", async () => {
    const { v2, manifest } = await setup();
    const plan = await planUpdate({
      file: v2,
      contents: await readMrpack(v2),
      manifest,
      gameDir: game,
      stagingDir: join(dir, "staging"),
    });
    expect(
      Object.fromEntries(plan.items.map((i) => [i.path, i.action])),
    ).toEqual({
      "config/edited.json": "changed",
      "config/gone-edited.json": "keepRemoved",
      "config/gone.json": "remove",
      "config/new.json": "add",
      "config/untouched.json": "update",
      "mods/old.jar": "remove",
      "mods/sodium-1.jar": "remove",
      "mods/sodium-2.jar": "add",
      "options.txt": "changed",
    });
    // Worlds are never part of an update; the user's own mod isn't the pack's.
    expect(plan.target).not.toHaveProperty(["saves/Pack World/level.dat"]);
    expect(plan.items.some((i) => i.path === "mods/mine.jar")).toBe(false);
  });
});

describe("applyUpdate", () => {
  it("replaces the pack's files, keeps the user's, and zips what it replaced", async () => {
    const { deps, v2, manifest } = await setup();
    const plan = await planUpdate({
      file: v2,
      contents: await readMrpack(v2),
      manifest,
      gameDir: game,
      stagingDir: join(dir, "staging"),
    });
    const backupFile = join(dir, "backup.zip");
    const result = await applyUpdate(deps, {
      plan,
      gameDir: game,
      replace: new Set(["config/edited.json"]),
      backupFile,
    });
    expect(result).toMatchObject({ added: 2, updated: 2, removed: 3 });
    const read = (p: string) => readFile(join(game, p), "utf8");
    expect(await read("config/edited.json")).toBe("v2"); // chosen
    expect(await read("options.txt")).toBe("fov:1\ngamma:5"); // kept
    expect(await read("config/gone-edited.json")).toBe("mine");
    expect(await read("config/untouched.json")).toBe("v2");
    expect(await read("mods/sodium-2.jar")).toBe("sodium2");
    expect(await read("mods/mine.jar")).toBe("mine");
    await expect(stat(join(game, "mods", "sodium-1.jar"))).rejects.toThrow();
    await expect(stat(join(game, "config", "gone.json"))).rejects.toThrow();

    const zip = unzipSync(await readFile(backupFile));
    expect(Object.keys(zip).sort()).toEqual([
      "config/edited.json",
      "config/gone.json",
      "config/untouched.json",
      "mods/old.jar",
      "mods/sodium-1.jar",
    ]);
    expect(strFromU8(zip["config/edited.json"]!)).toBe("mine");
  });

  it("replaces a hard-linked file without changing the stored copy", async () => {
    const { deps, manifest } = await setup();
    // The pack's config is a hard link into a store (as library files are).
    const store = join(dir, "store.json");
    await writeFile(store, "v1");
    await rm(join(game, "config", "untouched.json"));
    await link(store, join(game, "config", "untouched.json"));
    const v2 = await pack("v3.mrpack", V1, {
      "overrides/config/untouched.json": "v2",
    });
    const plan = await planUpdate({
      file: v2,
      contents: await readMrpack(v2),
      manifest,
      gameDir: game,
      stagingDir: join(dir, "staging"),
    });
    await applyUpdate(deps, {
      plan,
      gameDir: game,
      replace: new Set(),
      backupFile: join(dir, "b.zip"),
    });
    expect(await readFile(join(game, "config", "untouched.json"), "utf8")).toBe(
      "v2",
    );
    expect(await readFile(store, "utf8")).toBe("v1");
  });

  it("leaves optional files the user skipped out of updates", async () => {
    const files = [
      { path: "mods/a.jar", body: "a" },
      { path: "mods/map.jar", body: "map", env: { client: "optional" } },
    ];
    const v = await pack("o.mrpack", files, {});
    await mkdir(game, { recursive: true });
    const plan = await planUpdate({
      file: v,
      contents: await readMrpack(v),
      manifest: {
        schema: 1,
        name: "x",
        versionNumber: "1",
        files: {},
        skipped: ["mods/map.jar"],
      },
      gameDir: game,
      stagingDir: join(dir, "staging"),
    });
    expect(plan.items).toEqual([{ path: "mods/a.jar", action: "add" }]);
    expect(sha1("a")).toBe(plan.target["mods/a.jar"]);
  });
});
