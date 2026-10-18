import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfileStore } from "./profiles";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-profiles-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = () => createProfileStore(join(dir, "profiles.json"));
const base = {
  name: "My Fabric",
  gameVersion: "1.18.2",
  loader: { id: "fabric" },
};

describe("profile store", () => {
  it("creates profiles with a random id and keeps them", async () => {
    const a = await store().create(base);
    const b = await store().create({ ...base, name: "Other" });
    expect(a.id).not.toBe(b.id);
    expect((await store().list()).map((p) => p.name)).toEqual([
      "My Fabric",
      "Other",
    ]);
  });

  it.each([
    [{ ...base, name: "  " }],
    [{ ...base, name: "x".repeat(33) }],
    [{ ...base, gameVersion: "../evil" }],
    [{ ...base, loader: { id: "a/b" } }],
    [{ ...base, memoryMaxMb: 100 }],
    [{ ...base, extraJvmArgs: ["x".repeat(4097)] }],
    [{ ...base, extraGameArgs: "--width 1280" }],
    [{ ...base, unknown: 1 }],
  ])("refuses invalid input %#", async (input) => {
    await expect(store().create(input)).rejects.toMatchObject({
      code: "INVALID_PROFILE",
    });
  });

  it("pins and unpins; a pin isn't something the editor can send", async () => {
    const p = await store().create(base);
    expect((await store().setPinned(p.id, true)).pinned).toBe(true);
    expect((await store().list())[0]?.pinned).toBe(true);
    expect("pinned" in (await store().setPinned(p.id, false))).toBe(false);
    await expect(store().update(p.id, { pinned: true })).rejects.toMatchObject({
      code: "INVALID_PROFILE",
    });
  });

  it("trims the name", async () => {
    expect((await store().create({ ...base, name: "  Hi  " })).name).toBe("Hi");
  });

  it("forgets the installed version when the version or loader changes", async () => {
    const s = store();
    const p = await s.create(base);
    await s.setInstalled(p.id, "fabric-loader-0.19.5-1.18.2");

    const renamed = await s.update(p.id, { name: "Renamed" });
    expect(renamed.installedVersionId).toBe("fabric-loader-0.19.5-1.18.2");
    expect(renamed.id).toBe(p.id);

    const vanilla = await s.update(p.id, { loader: null });
    expect(vanilla.installedVersionId).toBeUndefined();

    await s.setInstalled(p.id, "1.18.2");
    expect(
      (await s.update(p.id, { gameVersion: "1.20.1" })).installedVersionId,
    ).toBeUndefined();
  });

  it("pins a loader build; changing it forgets the install", async () => {
    const s = store();
    const p = await s.create({
      ...base,
      loader: { id: "fabric", version: "0.19.5" },
    });
    expect(p.loader).toEqual({ id: "fabric", version: "0.19.5" });
    await s.setInstalled(p.id, "fabric-loader-0.19.5-1.18.2");
    const newest = await s.update(p.id, { loader: { id: "fabric" } });
    expect(newest.loader).toEqual({ id: "fabric" });
    expect(newest.installedVersionId).toBeUndefined();
    await expect(
      s.update(p.id, { loader: { id: "fabric", version: "../x" } }),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE" });
  });

  it("sets the mod pack link and custom icon (launcher-only fields)", async () => {
    const s = store();
    const p = await s.create(base);
    await s.setInstalled(p.id, "fabric-loader-0.19.5-1.18.2");
    const pack = { name: "FO", versionNumber: "1.0", projectId: "abc" };
    const linked = await s.setPack(p.id, { modpack: pack, customIcon: true });
    expect(linked).toMatchObject({ modpack: pack, customIcon: true });
    expect(linked.installedVersionId).toBe("fabric-loader-0.19.5-1.18.2");
    const moved = await s.setPack(p.id, {
      gameVersion: "1.20.1",
      loader: { id: "fabric", version: "0.16.0" },
    });
    expect(moved.installedVersionId).toBeUndefined();
    const plain = await s.setPack(p.id, { modpack: null, customIcon: false });
    expect(plain.modpack).toBeUndefined();
    expect(plain.customIcon).toBeUndefined();
    // The renderer can't set them.
    await expect(s.update(p.id, { modpack: pack })).rejects.toMatchObject({
      code: "INVALID_PROFILE",
    });
  });

  it("sets and clears optional settings", async () => {
    const s = store();
    const p = await s.create({
      ...base,
      memoryMaxMb: 4096,
      extraJvmArgs: ["-Xss2M"],
    });
    expect(p).toMatchObject({ memoryMaxMb: 4096, extraJvmArgs: ["-Xss2M"] });
    // An empty list is an override ("no extra arguments"); null goes back to global.
    const empty = await s.update(p.id, { extraJvmArgs: [], extraGameArgs: [] });
    expect(empty).toMatchObject({ extraJvmArgs: [], extraGameArgs: [] });
    const cleared = await s.update(p.id, {
      memoryMaxMb: null,
      extraJvmArgs: null,
      extraGameArgs: null,
    });
    expect(cleared.memoryMaxMb).toBeUndefined();
    expect(cleared.extraJvmArgs).toBeUndefined();
    expect(cleared.extraGameArgs).toBeUndefined();
  });

  it("stores and clears the icon", async () => {
    const s = store();
    const p = await s.create({ ...base, iconId: "creeper" });
    expect(p.iconId).toBe("creeper");
    expect((await s.update(p.id, { iconId: "diamond_block" })).iconId).toBe(
      "diamond_block",
    );
    expect((await s.update(p.id, { iconId: null })).iconId).toBeUndefined();
  });

  it("keeps every change when many happen at once", async () => {
    const s = store();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        s.create({ ...base, name: `P${i}` }),
      ),
    );
    expect(await s.list()).toHaveLength(10);
  });

  it("renaming doesn't create or move files", async () => {
    const s = store();
    const p = await s.create(base);
    const before = await readdir(dir);
    await s.update(p.id, { name: "New name" });
    expect(await readdir(dir)).toEqual(before);
  });

  it("fails for unknown profiles", async () => {
    await expect(store().update("nope", { name: "x" })).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
  });
});
