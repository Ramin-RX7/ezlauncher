import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeInstallMarker } from "../minecraft/installer";
import { createPaths, type Paths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { measureDisk } from "./diskUsage";
import { neededGameFiles, orphanGameFiles } from "./gameFiles";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-storage-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, body: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

const HASH = "a".repeat(40);
const OLD_HASH = "b".repeat(40);
const platform = detectPlatform("linux", "x64", "6.1");

/** One installed version `1.0` that needs `lib/a/1/a-1.jar` and asset `HASH`. */
async function installedVersion() {
  await put(
    paths.versionJson("1.0"),
    JSON.stringify({
      id: "1.0",
      assetIndex: { id: "idx", sha1: "0", size: 1, url: "https://x" },
      libraries: [
        {
          name: "lib:a:1",
          downloads: {
            artifact: {
              path: "lib/a/1/a-1.jar",
              sha1: "0",
              size: 1,
              url: "https://x",
            },
          },
        },
      ],
    }),
  );
  await writeInstallMarker(paths, "1.0");
  await put(paths.clientJar("1.0"), "client");
  await put(paths.library("lib/a/1/a-1.jar"), "needed");
  await put(
    paths.assetIndex("idx"),
    JSON.stringify({ objects: { "a.png": { hash: HASH, size: 3 } } }),
  );
  await put(paths.assetObject(HASH), "img");
}

describe("measureDisk", () => {
  it("counts a hard-linked file once, under its store, and never follows links", async () => {
    const stored = paths.modStoreFile("c".repeat(40));
    await put(stored, "x".repeat(1000));
    await mkdir(paths.modsDir("p1"), { recursive: true });
    await link(stored, join(paths.modsDir("p1"), "mod.jar"));
    await put(join(paths.gameDir("p1"), "options.txt"), "12345");
    await put(join(paths.worldDir("W"), "level.dat"), "w".repeat(100));
    await mkdir(paths.savesDir("p1"), { recursive: true });
    await symlink(
      paths.worldDir("W"),
      paths.saveLink("p1", "W"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await put(join(dir, "games", "old", "x"), "zz");

    const usage = await measureDisk(paths);
    expect(usage.categories.mods).toEqual({ bytes: 1000, files: 1 });
    expect(usage.categories.profiles).toEqual({ bytes: 5, files: 1 });
    expect(usage.categories.worlds).toEqual({ bytes: 100, files: 1 });
    expect(usage.categories.other).toEqual({ bytes: 2, files: 1 });
    expect(usage.totalBytes).toBe(1107);
  });
});

describe("orphan game files", () => {
  it("keeps what installed versions need and finds the rest", async () => {
    await installedVersion();
    await put(paths.library("lib/old/1/old-1.jar"), "old");
    await put(paths.assetObject(OLD_HASH), "old");
    await put(paths.assetIndex("gone"), "{}");
    await put(paths.versionJson("2.0"), "{}"); // never finished: no marker
    await put(join(paths.assetsVirtual("legacy"), "a.png"), "v");

    const needed = await neededGameFiles(paths, platform);
    if ("unknown" in needed) throw new Error(needed.unknown);
    const orphans = await orphanGameFiles(paths, needed);
    const rel = (p: string) =>
      p
        .slice(dir.length + 1)
        .split(sep)
        .join("/");
    expect(orphans.files.map((f) => rel(f.path)).sort()).toEqual([
      "assets/indexes/gone.json",
      `assets/objects/bb/${OLD_HASH}`,
      "libraries/lib/old/1/old-1.jar",
    ]);
    expect(orphans.folders.map((f) => rel(f.path)).sort()).toEqual([
      "assets/virtual/legacy",
      "versions/2.0",
    ]);
  });

  it("calls nothing unneeded when an installed version can't be read", async () => {
    await installedVersion();
    await writeInstallMarker(paths, "broken");
    await put(paths.versionJson("broken"), "not json");
    expect(await neededGameFiles(paths, platform)).toEqual({
      unknown: "broken",
    });
  });
});
