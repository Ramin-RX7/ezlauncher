import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPaths, type Paths } from "../minecraft/paths";
import {
  backupDue,
  backupKey,
  createBackup,
  deleteBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
} from "./backups";
import { isLink } from "./links";
import { listWorlds, readWorldOwner, syncWorlds, WORLD_FLAG } from "./worlds";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-backups-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A world in worlds/ with a few files, a subfolder, an empty folder, a flag and a lock. */
async function world(id = "Survival") {
  const w = paths.worldDir(id);
  await mkdir(join(w, "region"), { recursive: true });
  await mkdir(join(w, "datapacks"), { recursive: true });
  await writeFile(join(w, "level.dat"), "level");
  await writeFile(join(w, "region", "r.0.0.mca"), "x".repeat(200_000));
  await writeFile(join(w, WORLD_FLAG), '{"schema":1,"profileId":"p1"}');
  await writeFile(join(w, "session.lock"), "lock");
  return w;
}

let clock = Date.parse("2026-09-01T10:00:00Z");
const tick = () => new Date((clock += 60_000));

const backup = (sourceDir: string, reason: "manual" | "auto" = "manual") =>
  createBackup({
    paths,
    key: "Survival",
    sourceDir,
    worldName: "Survival",
    reason,
    now: tick,
  });

describe("createBackup / restoreBackup", () => {
  it("zips a world and restores it as a new world, without the flag and the lock", async () => {
    const w = await world();
    const progress: number[] = [];
    const result = await createBackup({
      paths,
      key: "Survival",
      sourceDir: w,
      worldName: "Survival",
      reason: "manual",
      now: tick,
      onProgress: (p) => progress.push(p.bytes),
    });
    expect("backup" in result).toBe(true);
    expect(progress.at(-1)).toBe(200_005);
    const [b] = await listBackups(paths, "Survival");
    expect(b).toMatchObject({ reason: "manual", worldBytes: 200_005 });
    expect(b!.sizeBytes).toBeLessThan(200_005); // compressed

    const newId = await restoreBackup(paths, "Survival", b!.id, "p2");
    expect(newId).toBe("Survival backup 2026-09-01");
    const restored = paths.worldDir(newId);
    expect(await readFile(join(restored, "region", "r.0.0.mca"), "utf8")).toBe(
      "x".repeat(200_000),
    );
    expect((await stat(join(restored, "datapacks"))).isDirectory()).toBe(true);
    await expect(stat(join(restored, "session.lock"))).rejects.toThrow();
    expect(await readWorldOwner(paths, newId)).toBe("p2");
    expect(await readWorldOwner(paths, "Survival")).toBe("p1"); // untouched
    // Nothing left over from unpacking.
    expect((await readdir(paths.backupsDir)).sort()).toEqual(["Survival"]);
  });

  it("skips a world that hasn't changed since its newest backup", async () => {
    const w = await world();
    await backup(w);
    expect("unchanged" in (await backup(w, "auto"))).toBe(true);
    // Only the lock or the flag changing doesn't count either.
    await writeFile(join(w, "session.lock"), "other");
    expect("unchanged" in (await backup(w))).toBe(true);

    await writeFile(join(w, "level.dat"), "played");
    const later = new Date(Date.now() + 5_000);
    await utimes(join(w, "level.dat"), later, later);
    expect("backup" in (await backup(w))).toBe(true);
    expect(await listBackups(paths, "Survival")).toHaveLength(2);
  });

  it("leaves nothing behind when cancelled", async () => {
    const w = await world();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createBackup({
        paths,
        key: "Survival",
        sourceDir: w,
        worldName: "Survival",
        reason: "manual",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(paths.backupDir("Survival"))).toEqual([]);
    expect(await listBackups(paths, "Survival")).toEqual([]);
  });

  it("refuses a backup whose entries leave the folder (zip slip)", async () => {
    const w = await world();
    await backup(w);
    const [b] = await listBackups(paths, "Survival");
    await writeFile(
      paths.backupFile("Survival", b!.id),
      zipSync({
        "level.dat": strToU8("x"),
        "../../evil.txt": strToU8("x"),
      }),
    );
    await expect(
      restoreBackup(paths, "Survival", b!.id, "p1"),
    ).rejects.toMatchObject({ code: "BACKUP_DAMAGED" });
    await expect(stat(join(dir, "evil.txt"))).rejects.toThrow();
    expect(await readdir(paths.backupsDir)).toEqual(["Survival"]);
  });

  it("a restored world is linked into its profile by the next sync", async () => {
    const w = await world();
    await backup(w);
    const [b] = await listBackups(paths, "Survival");
    const newId = await restoreBackup(paths, "Survival", b!.id, "p1");
    await syncWorlds({ paths }, { profileIds: ["p1"], isRunning: () => false });
    expect(await isLink(paths.saveLink("p1", newId))).toBe(true);
    expect((await listWorlds(paths, "p1")).map((x) => x.id).sort()).toEqual(
      ["Survival", newId].sort(),
    );
  });

  it("deletes one backup", async () => {
    const w = await world();
    await backup(w);
    const [b] = await listBackups(paths, "Survival");
    await deleteBackup(paths, "Survival", b!.id);
    expect(await listBackups(paths, "Survival")).toEqual([]);
    await expect(stat(paths.backupFile("Survival", b!.id))).rejects.toThrow();
  });
});

describe("pruneBackups", () => {
  async function makeFive() {
    const w = await world();
    for (let i = 0; i < 5; i++) {
      await writeFile(join(w, "level.dat"), `v${String(i)}`);
      const t = new Date(Date.now() + i * 10_000);
      await utimes(join(w, "level.dat"), t, t);
      // One backup a day, newest last.
      clock = Date.parse(`2026-09-0${String(i + 1)}T10:00:00Z`);
      await backup(w);
    }
  }
  // Two days back from here is the 3rd at 09:00, just before that day's backup.
  const now = () => new Date("2026-09-05T09:00:00Z");
  const dates = async () =>
    (await listBackups(paths, "Survival")).map((b) => b.createdAt.slice(8, 10));

  it("keeps at most N", async () => {
    await makeFive();
    expect(
      await pruneBackups(
        paths,
        "Survival",
        { keepCount: 2, keepDays: null },
        now,
      ),
    ).toBe(3);
    expect(await dates()).toEqual(["05", "04"]);
    expect(await readdir(paths.backupDir("Survival"))).toHaveLength(3); // 2 zips + index
  });

  it("drops backups older than D days", async () => {
    await makeFive();
    await pruneBackups(
      paths,
      "Survival",
      { keepCount: null, keepDays: 2 },
      now,
    );
    expect(await dates()).toEqual(["05", "04", "03"]);
  });

  it("always keeps the newest, and does nothing with no limits", async () => {
    await makeFive();
    await pruneBackups(
      paths,
      "Survival",
      { keepCount: null, keepDays: null },
      now,
    );
    expect(await dates()).toHaveLength(5);
    const muchLater = () => new Date("2027-09-05T12:00:00Z");
    await pruneBackups(
      paths,
      "Survival",
      { keepCount: null, keepDays: 1 },
      muchLater,
    );
    expect(await dates()).toEqual(["05"]);
  });
});

describe("backupDue", () => {
  const base = {
    backupAuto: "launch" as const,
    backupWhen: "afterExit" as const,
    backupIntervalDays: 7,
  };
  const now = new Date("2026-09-30T00:00:00Z");

  it("follows the mode and the moment", () => {
    expect(
      backupDue({ ...base, backupAuto: "off" }, undefined, "afterExit", now),
    ).toBe(false);
    expect(backupDue(base, undefined, "afterExit", now)).toBe(true);
    expect(backupDue(base, undefined, "beforeStart", now)).toBe(false);
  });

  it("waits N days in interval mode", () => {
    const interval = { ...base, backupAuto: "interval" as const };
    expect(backupDue(interval, undefined, "afterExit", now)).toBe(true);
    expect(backupDue(interval, "2026-09-25T00:00:00Z", "afterExit", now)).toBe(
      false,
    );
    expect(backupDue(interval, "2026-09-23T00:00:00Z", "afterExit", now)).toBe(
      true,
    );
  });
});

describe("backupKey", () => {
  it("uses the world id, or the profile and folder for unlinked worlds", () => {
    expect(backupKey({ id: "Survival", linked: true }, "p1")).toBe("Survival");
    expect(backupKey({ id: "Local", linked: false }, "p1")).toBe("p1~Local");
  });
});
