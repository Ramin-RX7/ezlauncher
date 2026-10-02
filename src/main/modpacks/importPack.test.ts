import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { importPackFiles } from "./importPack";
import { readMrpack } from "./readMrpack";
import {
  packIndex,
  packRoutes,
  writeMrpack,
  type FakePackFile,
} from "./testing/makeMrpack";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-import-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FILES: FakePackFile[] = [
  { path: "mods/sodium.jar", body: "sodium" },
  { path: "mods/minimap.jar", body: "minimap", env: { client: "optional" } },
  { path: "resourcepacks/Look.zip", body: "look" },
  { path: "config/sodium.json", body: "{}" },
];

async function setup(files = FILES) {
  const fake = createFakeFetch(packRoutes(files));
  const downloader = createDownloader({
    fetch: fake.fetch,
    userAgent: "t",
    retries: 0,
  });
  const file = join(dir, "p.mrpack");
  await writeMrpack(file, packIndex({ files }), {
    "overrides/config/sodium.json": '{"pack":true}',
    "overrides/options.txt": "fov:1",
  });
  return { fake, deps: { paths, downloader }, file };
}

describe("importPackFiles", () => {
  it("downloads every file, then the overrides win", async () => {
    const { deps, file } = await setup();
    const game = join(dir, "game");
    const result = await importPackFiles(deps, {
      file,
      contents: await readMrpack(file),
      gameDir: game,
      skip: new Set(),
    });
    expect(await readFile(join(game, "mods", "sodium.jar"), "utf8")).toBe(
      "sodium",
    );
    expect(await readFile(join(game, "mods", "minimap.jar"), "utf8")).toBe(
      "minimap",
    );
    expect(await readFile(join(game, "config", "sodium.json"), "utf8")).toBe(
      '{"pack":true}',
    );
    expect(result.files).toEqual({
      "mods/sodium.jar": sha1("sodium"),
      "mods/minimap.jar": sha1("minimap"),
      "resourcepacks/Look.zip": sha1("look"),
      "config/sodium.json": sha1('{"pack":true}'),
      "options.txt": sha1("fov:1"),
    });
    expect(result.skipped).toEqual([]);
  });

  it("leaves out unticked optional files, and only optional ones", async () => {
    const { deps, file } = await setup();
    const game = join(dir, "game");
    const result = await importPackFiles(deps, {
      file,
      contents: await readMrpack(file),
      gameDir: game,
      skip: new Set(["mods/minimap.jar", "mods/sodium.jar"]),
    });
    await expect(stat(join(game, "mods", "minimap.jar"))).rejects.toThrow();
    expect(await readFile(join(game, "mods", "sodium.jar"), "utf8")).toBe(
      "sodium",
    );
    expect(result.skipped).toEqual(["mods/minimap.jar"]);
  });

  it("links files a library already has instead of downloading them", async () => {
    const { deps, file, fake } = await setup();
    await mkdir(paths.modsStoreDir, { recursive: true });
    await writeFile(paths.modStoreFile(sha1("sodium")), "sodium");
    await importPackFiles(deps, {
      file,
      contents: await readMrpack(file),
      gameDir: join(dir, "game"),
      skip: new Set(),
    });
    expect(fake.requests.some((u) => u.includes("sodium.jar"))).toBe(false);
    const [a, b] = await Promise.all([
      stat(join(dir, "game", "mods", "sodium.jar")),
      stat(paths.modStoreFile(sha1("sodium"))),
    ]);
    expect(a.ino).toBe(b.ino);
  });

  it("fails on a bad download and leaves no temporary files", async () => {
    const files = [{ path: "mods/a.jar", body: "a" }];
    const { deps, file, fake } = await setup(files);
    fake.routes[Object.keys(packRoutes(files))[0]!] = "tampered";
    const game = join(dir, "game");
    await expect(
      importPackFiles(deps, {
        file,
        contents: await readMrpack(file),
        gameDir: game,
        skip: new Set(),
      }),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    await expect(stat(join(game, "mods", "a.jar"))).rejects.toThrow();
  });
});
