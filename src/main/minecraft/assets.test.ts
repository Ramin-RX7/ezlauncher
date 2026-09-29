import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../core/fsAtomic";
import { applyLegacyAssets, assetObjectTasks, gameAssetsDir } from "./assets";
import { createPaths, type Paths } from "./paths";
import { sha1 } from "./testing/fakeFetch";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-assets-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const data = "abc";
const objects = {
  "sound/a.ogg": { hash: sha1(data), size: 3 },
  "sound/b.ogg": { hash: sha1(data), size: 3 },
};

describe("assets", () => {
  it("downloads each object hash once", () => {
    expect(assetObjectTasks({ objects }, paths)).toHaveLength(1);
  });

  it("copies objects by name for `virtual` indexes", async () => {
    await writeFileAtomic(paths.assetObject(sha1(data)), data);
    const index = { objects, virtual: true };
    await applyLegacyAssets(index, "legacy", paths, paths.gameDir("1.6"));
    expect(
      await readFile(
        join(paths.assetsVirtual("legacy"), "sound", "b.ogg"),
        "utf8",
      ),
    ).toBe(data);
    expect(gameAssetsDir(index, "legacy", paths, "/g")).toBe(
      paths.assetsVirtual("legacy"),
    );
  });

  it("copies objects into the game folder for `map_to_resources` indexes", async () => {
    await writeFileAtomic(paths.assetObject(sha1(data)), data);
    const gameDir = paths.gameDir("b1.7.3");
    const index = { objects, map_to_resources: true };
    await applyLegacyAssets(index, "pre-1.6", paths, gameDir);
    expect(
      await readFile(join(gameDir, "resources", "sound", "a.ogg"), "utf8"),
    ).toBe(data);
    expect(gameAssetsDir(index, "pre-1.6", paths, gameDir)).toBe(
      join(gameDir, "resources"),
    );
  });

  it("does nothing for modern indexes", async () => {
    await applyLegacyAssets({ objects }, "19", paths, paths.gameDir("1.21"));
    expect(gameAssetsDir({ objects }, "19", paths, "/g")).toBe(paths.assetsDir);
  });
});
