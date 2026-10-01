import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPaths, type Paths } from "../minecraft/paths";
import { createModLibrary } from "./mods";
import { fabricMod } from "./testing/modJars";

// A drive without hard links (FAT32, exFAT): every link attempt fails.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    link: () =>
      Promise.reject(
        Object.assign(new Error("not supported"), { code: "EPERM" }),
      ),
  };
});

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-mods-copy-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("mod library without hard links", () => {
  it("copies the mod into the profile and says so", async () => {
    const lib = createModLibrary({ paths });
    const source = join(dir, "m.jar");
    await writeFile(source, fabricMod("m", "1"));
    const [mod] = await lib.add([source]);
    expect(await lib.enable("p", mod!.sha1)).toBe("copied");

    const copy = join(paths.modsDir("p"), "m.jar");
    expect((await stat(copy)).nlink).toBe(1);
    await lib.sync({ profileIds: ["p"], isRunning: () => false });
    const list = await lib.list({
      id: "p",
      gameVersion: "1.18.2",
      loader: { id: "fabric" },
    });
    expect(list[0]).toMatchObject({
      enabled: true,
      copied: true,
      usedBy: ["p"],
    });

    await lib.disable("p", mod!.sha1);
    await expect(stat(copy)).rejects.toThrow();
  });

  it("treats a copy that changed size as a new mod", async () => {
    const lib = createModLibrary({ paths });
    const source = join(dir, "c.jar");
    await writeFile(source, fabricMod("c", "1"));
    const [mod] = await lib.add([source]);
    await lib.enable("p", mod!.sha1);
    const copy = join(paths.modsDir("p"), "c.jar");
    await writeFile(copy, fabricMod("changed", "2.0.0-longer"));

    await lib.sync({ profileIds: ["p"], isRunning: () => false });
    const list = await lib.list();
    expect(list.find((m) => m.sha1 === mod!.sha1)?.usedBy).toEqual([]);
    expect(list.find((m) => m.modId === "changed")).toMatchObject({
      usedBy: ["p"],
    });
  });
});
