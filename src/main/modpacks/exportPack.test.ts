import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { exportEntries, exportModpack } from "./exportPack";
import { importPackFiles } from "./importPack";
import { readMrpack } from "./readMrpack";

let dir: string;
let paths: Paths;
let game: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-export-"));
  paths = createPaths(dir);
  game = join(dir, "game");
  await mkdir(join(game, "mods"), { recursive: true });
  await mkdir(join(game, "config"), { recursive: true });
  await mkdir(join(game, "logs"), { recursive: true });
  await mkdir(join(game, "saves"), { recursive: true });
  await writeFile(join(game, "mods", "sodium.jar"), "sodium");
  await writeFile(join(game, "mods", "custom.jar"), "custom");
  await writeFile(join(game, "config", "sodium.json"), "{}");
  await writeFile(join(game, "logs", "latest.log"), "log");
  await writeFile(join(game, "options.txt"), "fov:1");
  await writeFile(join(game, "options.txt.ezl-bak"), "fov:0");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SODIUM_URL = "https://cdn.modrinth.com/data/AANobbMI/sodium.jar";

describe("exportEntries", () => {
  it("offers the folder's entries, not worlds or backups, with logs unticked", async () => {
    expect(await exportEntries(game)).toEqual([
      { name: "config", folder: true, suggested: true },
      { name: "logs", folder: true, suggested: false },
      { name: "mods", folder: true, suggested: true },
      { name: "options.txt", folder: false, suggested: true },
    ]);
  });
});

describe("exportModpack", () => {
  it("links known mods, packs the rest, and imports back the same", async () => {
    const dest = join(dir, "out.mrpack");
    const result = await exportModpack(paths, {
      gameDir: game,
      include: ["mods", "config", "options.txt"],
      name: "Mine",
      versionNumber: "1.0",
      dependencies: { minecraft: "1.20.1", "fabric-loader": "0.16.0" },
      identify: (sha1s) =>
        Promise.resolve(
          new Map(
            sha1s
              .filter((s) => s === sha1("sodium"))
              .map((s) => [s, SODIUM_URL]),
          ),
        ),
      dest,
    });
    expect(result).toEqual({
      downloads: 1,
      included: 3,
      unknown: ["mods/custom.jar"],
    });

    const contents = await readMrpack(dest);
    expect(contents.index).toMatchObject({
      name: "Mine",
      versionNumber: "1.0",
      requires: {
        gameVersion: "1.20.1",
        loader: "fabric",
        loaderVersion: "0.16.0",
      },
      files: [
        { path: "mods/sodium.jar", sha1: sha1("sodium"), url: SODIUM_URL },
      ],
    });
    expect(contents.overrides.map((o) => o.path).sort()).toEqual([
      "config/sodium.json",
      "mods/custom.jar",
      "options.txt",
    ]);

    const fake = createFakeFetch({ [SODIUM_URL]: "sodium" });
    const back = join(dir, "back");
    const imported = await importPackFiles(
      {
        paths,
        downloader: createDownloader({
          fetch: fake.fetch,
          userAgent: "t",
          retries: 0,
        }),
      },
      { file: dest, contents, gameDir: back, skip: new Set() },
    );
    expect(Object.keys(imported.files).sort()).toEqual([
      "config/sodium.json",
      "mods/custom.jar",
      "mods/sodium.jar",
      "options.txt",
    ]);
  });
});
