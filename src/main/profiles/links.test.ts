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
import {
  createDirLink,
  createHardLink,
  isLink,
  linkTarget,
  removeLink,
  removeTree,
  sameFile,
} from "./links";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-links-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function world() {
  const target = join(dir, "worlds", "w");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "level.dat"), "data");
  return target;
}

describe("directory links", () => {
  it("creates, detects and removes a link without touching the target", async () => {
    const target = await world();
    const link = join(dir, "saves-w");
    await createDirLink(target, link);
    expect(await isLink(link)).toBe(true);
    expect(await linkTarget(link)).toBe(target);
    expect(await readFile(join(link, "level.dat"), "utf8")).toBe("data");

    await removeLink(link);
    expect(await isLink(link)).toBe(false);
    expect(await readFile(join(target, "level.dat"), "utf8")).toBe("data");
  });

  it("refuses to remove something that isn't a link", async () => {
    const target = await world();
    await expect(removeLink(target)).rejects.toThrow();
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it("deletes a tree without following links inside it", async () => {
    const target = await world();
    const profile = join(dir, "profile");
    await mkdir(join(profile, "saves"), { recursive: true });
    await writeFile(join(profile, "options.txt"), "x");
    await createDirLink(target, join(profile, "saves", "w"));

    await removeTree(profile);
    await expect(stat(profile)).rejects.toThrow();
    expect(await readFile(join(target, "level.dat"), "utf8")).toBe("data");
  });
});

describe("hard links", () => {
  it("links a file so both names are the same file", async () => {
    const src = join(dir, "a.jar");
    await writeFile(src, "jar");
    const dest = join(dir, "b.jar");
    expect(await createHardLink(src, dest)).toBe("linked");
    expect(await sameFile(src, dest)).toBe(true);
    expect((await stat(src)).nlink).toBe(2);
  });

  it("tells different files apart", async () => {
    await writeFile(join(dir, "a"), "same");
    await writeFile(join(dir, "b"), "same");
    expect(await sameFile(join(dir, "a"), join(dir, "b"))).toBe(false);
    expect(await sameFile(join(dir, "a"), join(dir, "missing"))).toBe(false);
  });

  it("never overwrites an existing file", async () => {
    await writeFile(join(dir, "a"), "a");
    await writeFile(join(dir, "b"), "b");
    await expect(
      createHardLink(join(dir, "a"), join(dir, "b")),
    ).rejects.toThrow();
    expect(await readFile(join(dir, "b"), "utf8")).toBe("b");
  });
});
