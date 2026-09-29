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
    [{ ...base, extraJvmArgs: [""] }],
    [{ ...base, unknown: 1 }],
  ])("refuses invalid input %#", async (input) => {
    await expect(store().create(input)).rejects.toMatchObject({
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

  it("sets and clears optional settings", async () => {
    const s = store();
    const p = await s.create({
      ...base,
      memoryMaxMb: 4096,
      extraJvmArgs: ["-Xss2M"],
    });
    expect(p).toMatchObject({ memoryMaxMb: 4096, extraJvmArgs: ["-Xss2M"] });
    const cleared = await s.update(p.id, {
      memoryMaxMb: null,
      extraJvmArgs: [],
    });
    expect(cleared.memoryMaxMb).toBeUndefined();
    expect(cleared.extraJvmArgs).toBeUndefined();
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
