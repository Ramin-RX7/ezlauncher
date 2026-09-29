import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPaths, type Paths } from "../minecraft/paths";
import { isLink, removeTree } from "./links";
import { makeLevelDat } from "./testing/levelDat";
import {
  copyProfileWorlds,
  deleteWorld,
  listOrphans,
  listWorlds,
  moveWorld,
  readWorldOwner,
  rescueUnlinkedWorlds,
  syncWorlds,
} from "./worlds";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-worlds-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const A = "profile-a";
const B = "profile-b";
const notRunning = () => false;
const deps = () => ({ paths });
const sync = (
  only?: string[],
  isRunning: (id: string) => boolean = notRunning,
) =>
  syncWorlds(deps(), { profileIds: [A, B], ...(only && { only }), isRunning });

/** A world the game created in a profile's saves/. */
async function gameWorld(profileId: string, folder: string, name = folder) {
  const world = join(paths.savesDir(profileId), folder);
  await mkdir(join(world, "region"), { recursive: true });
  await writeFile(
    join(world, "level.dat"),
    makeLevelDat(name, 1_700_000_000_000),
  );
  await writeFile(join(world, "region", "r.0.0.mca"), "chunks");
  return world;
}

const savesOf = async (profileId: string) =>
  (await readdir(paths.savesDir(profileId)).catch(() => [])).sort();

describe("syncWorlds", () => {
  it("adopts a world created in game into worlds/, flags it and links it back", async () => {
    const created = await gameWorld(A, "New World");
    await sync();

    expect(await readWorldOwner(paths, "New World")).toBe(A);
    expect(await isLink(created)).toBe(true);
    expect(
      await readFile(
        join(paths.worldDir("New World"), "region", "r.0.0.mca"),
        "utf8",
      ),
    ).toBe("chunks");
    // Still readable through the link, as Minecraft sees it.
    expect(await readFile(join(created, "region", "r.0.0.mca"), "utf8")).toBe(
      "chunks",
    );
    expect(await savesOf(B)).toEqual([]);
  });

  it("names a world -2 when its folder name is taken", async () => {
    await gameWorld(A, "World");
    await sync();
    await gameWorld(B, "World");
    await sync();
    expect((await readdir(paths.worldsDir)).sort()).toEqual([
      "World",
      "World-2",
    ]);
    expect(await readWorldOwner(paths, "World-2")).toBe(B);
    expect(await savesOf(B)).toEqual(["World-2"]);
  });

  it("rebuilds links from the flags and removes stale ones", async () => {
    await gameWorld(A, "Keep");
    await gameWorld(A, "Gone");
    await sync();
    await removeTree(paths.worldDir("Gone")); // world vanished some other way
    await rm(paths.saveLink(A, "Keep")); // link lost
    await sync();
    expect(await savesOf(A)).toEqual(["Keep"]);
    expect(await isLink(paths.saveLink(A, "Keep"))).toBe(true);
  });

  it("removes a world deleted in game (its folder emptied through the link)", async () => {
    await gameWorld(A, "Doomed");
    await sync();
    // Minecraft deletes the contents but leaves the folder.
    for (const name of await readdir(paths.worldDir("Doomed")))
      if (name !== "ezlauncher-world.json")
        await rm(join(paths.worldDir("Doomed"), name), { recursive: true });
    await sync();
    await expect(stat(paths.worldDir("Doomed"))).rejects.toThrow();
    expect(await savesOf(A)).toEqual([]);
  });

  it("never touches a profile while its game runs", async () => {
    const created = await gameWorld(A, "Busy");
    await sync(undefined, (id) => id === A);
    expect(await isLink(created)).toBe(false);
    expect(await readdir(paths.worldsDir)).toEqual([]);
  });

  it("reports worlds of deleted profiles as orphans and never deletes them", async () => {
    await gameWorld(A, "Lonely", "Lonely Hills");
    await sync();
    const result = await syncWorlds(deps(), {
      profileIds: [B],
      isRunning: notRunning,
    });
    expect(result.orphans).toEqual([
      expect.objectContaining({ id: "Lonely", name: "Lonely Hills" }),
    ]);
    expect(await listOrphans(paths, [B])).toHaveLength(1);
    expect((await stat(paths.worldDir("Lonely"))).isDirectory()).toBe(true);
  });
});

describe("listWorlds", () => {
  it("lists a profile's worlds with their in-game name", async () => {
    await gameWorld(A, "w1", "Castle");
    await gameWorld(B, "w2", "Farm");
    await sync();
    expect(await listWorlds(paths, A)).toEqual([
      {
        id: "w1",
        name: "Castle",
        linked: true,
        lastPlayed: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
  });
});

describe("moveWorld", () => {
  it("moves a world so it shows only in the other profile", async () => {
    await gameWorld(A, "Trip");
    await sync();
    await moveWorld(deps(), "Trip", B, {
      profileIds: [A, B],
      isRunning: notRunning,
    });
    expect(await readWorldOwner(paths, "Trip")).toBe(B);
    expect(await savesOf(A)).toEqual([]);
    expect(await savesOf(B)).toEqual(["Trip"]);
  });

  it("refuses unknown profiles", async () => {
    await gameWorld(A, "Trip");
    await sync();
    await expect(
      moveWorld(deps(), "Trip", "nobody", {
        profileIds: [A, B],
        isRunning: notRunning,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_FOUND" });
  });
});

describe("deleting", () => {
  it("deleting a profile's folder keeps the worlds linked into it", async () => {
    await gameWorld(A, "Precious");
    await sync();
    await removeTree(paths.gameDir(A));
    expect(
      await readFile(
        join(paths.worldDir("Precious"), "region", "r.0.0.mca"),
        "utf8",
      ),
    ).toBe("chunks");
  });

  it("moves worlds not synced yet out of a profile before it goes", async () => {
    await gameWorld(A, "Fresh");
    await rescueUnlinkedWorlds(paths, A, B);
    expect(await readWorldOwner(paths, "Fresh")).toBe(B);
    await removeTree(paths.gameDir(A));
    await sync([B]);
    expect(await savesOf(B)).toEqual(["Fresh"]);
  });

  it("deleteWorld removes the links and the world", async () => {
    await gameWorld(A, "Bye");
    await sync();
    await deleteWorld(paths, "Bye");
    await expect(stat(paths.worldDir("Bye"))).rejects.toThrow();
    expect(await savesOf(A)).toEqual([]);
  });

  it("copies a profile's worlds for a duplicate; the copies belong to it", async () => {
    await gameWorld(A, "Survival");
    await sync();
    // Minecraft's lock file isn't copied.
    await writeFile(join(paths.worldDir("Survival"), "session.lock"), "x");

    expect(await copyProfileWorlds(paths, A, B)).toBe(1);
    await sync([B]);

    const copies = await listWorlds(paths, B);
    expect(copies).toHaveLength(1);
    const copy = copies[0]!;
    expect(copy.id).not.toBe("Survival"); // its own folder in worlds/
    expect(await readWorldOwner(paths, copy.id)).toBe(B);
    expect(await readWorldOwner(paths, "Survival")).toBe(A); // original untouched
    expect(
      await readFile(
        join(paths.worldDir(copy.id), "region", "r.0.0.mca"),
        "utf8",
      ),
    ).toBe("chunks");
    await expect(
      stat(join(paths.worldDir(copy.id), "session.lock")),
    ).rejects.toThrow();
    expect((await listWorlds(paths, A)).map((w) => w.id)).toEqual(["Survival"]);
  });
});
