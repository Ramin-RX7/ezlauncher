import {
  chmod,
  link,
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
import { createDirLink, isLink, linkTarget } from "../profiles/links";
import { moveDataDir, type MoveProgress } from "./moveData";

let root: string;
let from: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ezl-move-"));
  from = join(root, "old");
  // A small data folder: a stored mod hard-linked into a profile, and a world linked into saves/.
  await mkdir(join(from, "mods-store"), { recursive: true });
  await mkdir(join(from, "profiles", "p1", "mods"), { recursive: true });
  await mkdir(join(from, "profiles", "p1", "saves"), { recursive: true });
  await mkdir(join(from, "worlds", "w1"), { recursive: true });
  await mkdir(join(from, "launcher"), { recursive: true });
  await writeFile(join(from, "mods-store", "abc.jar"), "jar bytes");
  await link(
    join(from, "mods-store", "abc.jar"),
    join(from, "profiles", "p1", "mods", "sodium.jar"),
  );
  await writeFile(join(from, "worlds", "w1", "level.dat"), "world");
  await writeFile(join(from, "launcher", "accounts.json"), "{}");
  await createDirLink(
    join(from, "worlds", "w1"),
    join(from, "profiles", "p1", "saves", "w1"),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function expectMoved(to: string) {
  expect(await readFile(join(to, "launcher", "accounts.json"), "utf8")).toBe(
    "{}",
  );
  // The mod is still one file with two names.
  const store = await stat(join(to, "mods-store", "abc.jar"));
  const inProfile = await stat(
    join(to, "profiles", "p1", "mods", "sodium.jar"),
  );
  expect(store.ino).toBe(inProfile.ino);
  expect(store.nlink).toBe(2);
  // The world link points into the new folder and works.
  const save = join(to, "profiles", "p1", "saves", "w1");
  expect(await isLink(save)).toBe(true);
  expect(await linkTarget(save)).toBe(join(to, "worlds", "w1"));
  expect(await readFile(join(save, "level.dat"), "utf8")).toBe("world");
  // The old folder is gone.
  await expect(stat(from)).rejects.toThrow();
}

describe("moveDataDir", () => {
  it("copies to another drive, keeping hard links and re-pointing world links", async () => {
    const to = join(root, "new");
    const steps: MoveProgress[] = [];
    await moveDataDir(from, to, {
      forceCopy: true,
      onProgress: (p) => steps.push(p),
    });
    await expectMoved(to);
    const last = steps.filter((s) => s.step === "copying").at(-1);
    expect(last).toMatchObject({ files: 4, totalFiles: 4 });
    expect(last?.bytes).toBe(last?.totalBytes);
    expect(steps.at(-1)?.step).toBe("cleaning");
  });

  it("renames on the same drive, and still re-points world links", async () => {
    const to = join(root, "deeper", "new");
    await moveDataDir(from, to);
    await expectMoved(to);
  });

  it("moves into an empty folder that already exists", async () => {
    const to = join(root, "empty");
    await mkdir(to);
    await moveDataDir(from, to, { forceCopy: true });
    await expectMoved(to);
  });

  it("refuses a folder that isn't empty, or one inside the other", async () => {
    const full = join(root, "full");
    await mkdir(full);
    await writeFile(join(full, "x.txt"), "x");
    await expect(moveDataDir(from, full)).rejects.toMatchObject({
      code: "DATA_DIR_NOT_EMPTY",
    });
    await expect(moveDataDir(from, join(from, "sub"))).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(moveDataDir(from, root)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("leaves the old folder as it was when cancelled, and removes the partial copy", async () => {
    const to = join(root, "new");
    const controller = new AbortController();
    await expect(
      moveDataDir(from, to, {
        forceCopy: true,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.step === "copying" && p.files === 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(stat(to)).rejects.toThrow();
    expect((await readdir(from)).sort()).toEqual([
      "launcher",
      "mods-store",
      "profiles",
      "worlds",
    ]);
    expect(
      await readFile(join(from, "worlds", "w1", "level.dat"), "utf8"),
    ).toBe("world");
  });

  it.skipIf(process.platform === "win32")(
    "keeps the old folder when a file can't be copied",
    async () => {
      const locked = join(from, "launcher", "locked.json");
      await writeFile(locked, "secret");
      await chmod(locked, 0o000);
      const to = join(root, "new");
      await expect(
        moveDataDir(from, to, { forceCopy: true }),
      ).rejects.toThrow();
      await chmod(locked, 0o600);
      await expect(stat(to)).rejects.toThrow();
      expect(await readFile(locked, "utf8")).toBe("secret");
    },
  );
});
