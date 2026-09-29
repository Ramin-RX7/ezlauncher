import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../core/fsAtomic";
import { writeInstallMarker } from "../minecraft/installer";
import { createPaths, type Paths } from "../minecraft/paths";
import { MIGRATION_MARKER, migrateLegacyGames } from "./migrate";
import { createProfileStore } from "./profiles";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-migrate-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function oldGameDir(versionId: string) {
  const game = join(paths.legacyGamesDir, versionId);
  await mkdir(join(game, "saves", "World"), { recursive: true });
  await writeFile(join(game, "options.txt"), `version ${versionId}`);
  await writeFile(join(game, "saves", "World", "level.dat"), "x");
  return game;
}

const FABRIC = "fabric-loader-0.19.5-1.18.2";

describe("migrateLegacyGames", () => {
  it("turns each games/<version> folder into a profile with its files", async () => {
    await oldGameDir("1.8.9");
    await oldGameDir(FABRIC);
    await writeInstallMarker(paths, "1.8.9");
    await writeInstallMarker(paths, FABRIC, {
      loader: { id: "fabric", loaderVersion: "0.19.5", gameVersion: "1.18.2" },
    });
    const profiles = createProfileStore(paths.launcherFile("profiles.json"));

    const created = await migrateLegacyGames({ paths, profiles });
    expect(created).toHaveLength(2);
    const list = await profiles.list();
    const byName = Object.fromEntries(list.map((p) => [p.name, p]));
    expect(byName["1.8.9"]).toMatchObject({
      gameVersion: "1.8.9",
      loader: null,
      installedVersionId: "1.8.9",
    });
    expect(byName[FABRIC]).toMatchObject({
      gameVersion: "1.18.2",
      loader: { id: "fabric" },
      installedVersionId: FABRIC,
    });
    const id = byName["1.8.9"]?.id ?? "";
    expect(await readFile(join(paths.gameDir(id), "options.txt"), "utf8")).toBe(
      "version 1.8.9",
    );
    expect(await readdir(paths.gameDir(id))).not.toContain(MIGRATION_MARKER);
    await expect(stat(paths.legacyGamesDir)).rejects.toThrow(); // emptied and removed
  });

  it("does nothing the second time", async () => {
    await oldGameDir("1.8.9");
    const profiles = createProfileStore(paths.launcherFile("profiles.json"));
    await migrateLegacyGames({ paths, profiles });
    expect(await migrateLegacyGames({ paths, profiles })).toEqual([]);
    expect(await profiles.list()).toHaveLength(1);
  });

  it("finishes a migration that crashed after moving the folder", async () => {
    const game = await oldGameDir("1.12.2");
    await writeJsonAtomic(join(game, MIGRATION_MARKER), {
      schema: 1,
      versionId: "1.12.2",
      profileId: "crashed-id",
    });
    await mkdir(paths.profilesDir, { recursive: true });
    await rename(game, paths.gameDir("crashed-id"));

    const profiles = createProfileStore(paths.launcherFile("profiles.json"));
    expect(await migrateLegacyGames({ paths, profiles })).toEqual([
      "crashed-id",
    ]);
    expect(await profiles.get("crashed-id")).toMatchObject({
      name: "1.12.2",
      gameVersion: "1.12.2",
    });
  });
});
