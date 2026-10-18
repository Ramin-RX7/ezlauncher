import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPaths, type Paths } from "../minecraft/paths";
import { createDirLink, isLink, linkTarget, removeTree } from "./links";
import { syncScreenshots } from "./screenshots";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-shots-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const idle = (): boolean => false;
const sync = (
  profileIds: string[],
  isRunning: (id: string) => boolean = idle,
) => syncScreenshots({ paths }, { profileIds, isRunning });

describe("syncScreenshots", () => {
  it("links every profile to the shared folder", async () => {
    await sync(["p1", "p2"]);
    for (const id of ["p1", "p2"]) {
      expect(await isLink(paths.screenshotsLink(id))).toBe(true);
      expect(await linkTarget(paths.screenshotsLink(id))).toBe(
        paths.screenshotsDir,
      );
    }
    // A screenshot taken in one profile is in the shared folder.
    await writeFile(join(paths.screenshotsLink("p1"), "a.png"), "x");
    expect(await readdir(paths.screenshotsDir)).toEqual(["a.png"]);
  });

  it("moves screenshots taken before into the shared folder, renaming clashes", async () => {
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeFile(join(paths.screenshotsDir, "2026.png"), "shared");
    await mkdir(paths.screenshotsLink("p1"), { recursive: true });
    await writeFile(join(paths.screenshotsLink("p1"), "2026.png"), "mine");
    await writeFile(join(paths.screenshotsLink("p1"), "other.png"), "o");

    await sync(["p1"]);
    expect((await readdir(paths.screenshotsDir)).sort()).toEqual([
      "2026 (2).png",
      "2026.png",
      "other.png",
    ]);
    expect(
      await readFile(join(paths.screenshotsDir, "2026 (2).png"), "utf8"),
    ).toBe("mine");
    expect(await isLink(paths.screenshotsLink("p1"))).toBe(true);
  });

  it("fixes a link that points elsewhere, and leaves running profiles alone", async () => {
    const elsewhere = join(dir, "elsewhere");
    await mkdir(elsewhere);
    await mkdir(paths.gameDir("p1"), { recursive: true });
    await createDirLink(elsewhere, paths.screenshotsLink("p1"));
    await mkdir(paths.screenshotsLink("p2"), { recursive: true });

    await sync(["p1", "p2"], (id) => id === "p2");
    expect(await linkTarget(paths.screenshotsLink("p1"))).toBe(
      paths.screenshotsDir,
    );
    expect(await isLink(paths.screenshotsLink("p2"))).toBe(false);
  });

  it("keeps the screenshots when a profile is deleted", async () => {
    await sync(["p1"]);
    await writeFile(join(paths.screenshotsLink("p1"), "a.png"), "x");
    await removeTree(paths.gameDir("p1"));
    expect(await readdir(paths.screenshotsDir)).toEqual(["a.png"]);
  });

  it("leaves a file where the folder should be", async () => {
    await mkdir(paths.gameDir("p1"), { recursive: true });
    await writeFile(paths.screenshotsLink("p1"), "not a folder");
    await sync(["p1"]);
    expect(await readFile(paths.screenshotsLink("p1"), "utf8")).toBe(
      "not a folder",
    );
  });
});
