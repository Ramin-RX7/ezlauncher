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
import { createPaths, type Paths } from "../minecraft/paths";
import { sha1 } from "../minecraft/testing/fakeFetch";
import { sameFile } from "./links";
import { createModLibrary, INFO_VERSION } from "./mods";
import { fabricJar, fabricMod } from "./testing/modJars";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-mods-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const A = "profile-a";
const B = "profile-b";
const fabric = { gameVersion: "1.18.2", loader: { id: "fabric" } };
const syncAll = (lib: ReturnType<typeof createModLibrary>) =>
  lib.sync({ profileIds: [A, B], isRunning: () => false });

/** A jar somewhere outside the data folder, as picked in a file dialog. */
async function download(name: string, bytes: Uint8Array) {
  const downloads = join(dir, "downloads");
  await mkdir(downloads, { recursive: true });
  const path = join(downloads, name);
  await writeFile(path, bytes);
  return path;
}

const modsOf = async (profileId: string) =>
  (await readdir(paths.modsDir(profileId)).catch(() => [])).sort();

describe("mod library", () => {
  it("stores a jar once by hash and reads its metadata", async () => {
    const lib = createModLibrary({ paths });
    const jar = fabricMod("sodium", "0.4.1");
    const [first] = await lib.add([await download("sodium-0.4.1.jar", jar)]);
    const [again] = await lib.add([await download("copy.jar", jar)]);
    expect(first).toMatchObject({ sha1: sha1(jar), added: true });
    expect(again).toMatchObject({ sha1: sha1(jar), added: false });
    expect(await readdir(paths.modsStoreDir)).toEqual([`${sha1(jar)}.jar`]);
    expect(await lib.list()).toEqual([
      expect.objectContaining({
        sha1: sha1(jar),
        modId: "sodium",
        name: "sodium mod",
        version: "0.4.1",
        loaders: ["fabric"],
        mcVersionRange: ">=1.18",
        usedBy: [],
      }),
    ]);
  });

  it("records dependencies, and a mod the user adds stays theirs", async () => {
    const lib = createModLibrary({ paths });
    const api = fabricMod("fabric-api", "0.90.0");
    const sodium = fabricJar({
      schemaVersion: 1,
      id: "sodium",
      version: "0.5.0",
      depends: { "fabric-api": "*" },
    });
    await mkdir(paths.modsStoreDir, { recursive: true });
    for (const jar of [api, sodium])
      await writeFile(paths.modStoreFile(sha1(jar)), jar);
    const source = {
      sourceId: "fake",
      projectId: "p",
      versionId: "v",
      pageUrl: "https://fake",
    };
    await lib.addStored([
      { sha1: sha1(sodium), fileName: "sodium.jar", source, addedAs: "user" },
      { sha1: sha1(api), fileName: "api.jar", source, addedAs: "dependency" },
    ]);
    const byName = async (id: string) =>
      (await lib.list()).find((m) => m.modId === id);
    expect(await byName("fabric-api")).toMatchObject({
      dependency: true,
      neededBy: [sha1(sodium)],
    });
    expect((await byName("sodium"))?.dependency).toBe(false);

    // Adding it yourself promotes it; a later download never demotes it.
    await lib.add([await download("api.jar", api)]);
    await lib.addStored([
      { sha1: sha1(api), fileName: "api.jar", source, addedAs: "dependency" },
    ]);
    expect((await byName("fabric-api"))?.dependency).toBe(false);
  });

  it("shares one stored file between two profiles (hard links)", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([
      await download("lithium.jar", fabricMod("lithium", "1")),
    ]);
    await lib.enable(A, mod!.sha1);
    await lib.enable(B, mod!.sha1);

    const store = paths.modStoreFile(mod!.sha1);
    expect((await stat(store)).nlink).toBe(3);
    expect(await sameFile(join(paths.modsDir(A), "lithium.jar"), store)).toBe(
      true,
    );
    expect(
      (await lib.list()).find((m) => m.sha1 === mod!.sha1)?.usedBy.sort(),
    ).toEqual([A, B]);
    expect((await lib.list({ id: A, ...fabric }))[0]).toMatchObject({
      enabled: true,
      compat: { status: "compatible" },
    });
  });

  it("keeps a mod in the library when it's unticked everywhere, then removes it as unused", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("m.jar", fabricMod("m", "1"))]);
    await lib.enable(A, mod!.sha1);
    await lib.disable(A, mod!.sha1);
    expect(await modsOf(A)).toEqual([]);
    expect((await lib.list())[0]?.usedBy).toEqual([]);
    expect(await stat(paths.modStoreFile(mod!.sha1))).toBeTruthy();

    expect(await lib.removeUnused()).toBe(1);
    expect(await lib.list()).toEqual([]);
    await expect(stat(paths.modStoreFile(mod!.sha1))).rejects.toThrow();
  });

  it("allows one version per mod id in a profile", async () => {
    const lib = createModLibrary({ paths });
    const [v1] = await lib.add([
      await download("fapi-1.jar", fabricMod("fabric-api", "1")),
    ]);
    const [v2] = await lib.add([
      await download("fapi-2.jar", fabricMod("fabric-api", "2")),
    ]);
    await lib.enable(A, v1!.sha1);
    await lib.enable(A, v2!.sha1);
    expect(await modsOf(A)).toEqual(["fapi-2.jar"]);
    const list = await lib.list({ id: A, ...fabric });
    expect(list.filter((m) => m.enabled).map((m) => m.version)).toEqual(["2"]);
  });

  it("adopts a jar dropped into mods/ by hand and keeps it enabled", async () => {
    const lib = createModLibrary({ paths });
    const jar = fabricMod("handmade", "1");
    await mkdir(paths.modsDir(A), { recursive: true });
    const dropped = join(paths.modsDir(A), "handmade.jar");
    await writeFile(dropped, jar);

    await syncAll(lib);
    const store = paths.modStoreFile(sha1(jar));
    expect(await sameFile(dropped, store)).toBe(true);
    expect((await lib.list())[0]).toMatchObject({
      modId: "handmade",
      usedBy: [A],
    });

    // The same jar dropped into another profile is linked, not stored twice.
    await mkdir(paths.modsDir(B), { recursive: true });
    await writeFile(join(paths.modsDir(B), "again.jar"), jar);
    await syncAll(lib);
    expect(await sameFile(join(paths.modsDir(B), "again.jar"), store)).toBe(
      true,
    );
    expect(await readdir(paths.modsStoreDir)).toEqual([`${sha1(jar)}.jar`]);
  });

  it("turns a hand-dropped copy of a stored jar into a link to the stored one", async () => {
    const lib = createModLibrary({ paths });
    const jar = fabricMod("known", "1");
    await lib.add([await download("known.jar", jar)]);
    await mkdir(paths.modsDir(A), { recursive: true });
    const dropped = join(paths.modsDir(A), "my-copy.jar");
    await writeFile(dropped, jar);

    await syncAll(lib);
    const store = paths.modStoreFile(sha1(jar));
    expect(await sameFile(dropped, store)).toBe(true);
    expect((await stat(store)).nlink).toBe(2);
    expect(await readdir(paths.modsStoreDir)).toEqual([`${sha1(jar)}.jar`]);
    expect((await lib.list())[0]?.usedBy).toEqual([A]);
  });

  it("treats a linked file replaced by another jar under the same name as a new mod", async () => {
    const lib = createModLibrary({ paths });
    const [old] = await lib.add([
      await download("swap.jar", fabricMod("old", "1")),
    ]);
    await lib.enable(A, old!.sha1);
    const path = join(paths.modsDir(A), "swap.jar");
    await rm(path);
    const replacement = fabricMod("new", "1");
    await writeFile(path, replacement);

    await syncAll(lib);
    const byId = async (id: string) =>
      (await lib.list()).find((m) => m.modId === id);
    expect((await byId("old"))?.usedBy).toEqual([]);
    expect((await byId("new"))?.usedBy).toEqual([A]);
    expect(await sameFile(path, paths.modStoreFile(sha1(replacement)))).toBe(
      true,
    );
  });

  it("gives a mod a different file name when its name is taken in the profile", async () => {
    const lib = createModLibrary({ paths });
    const [first] = await lib.add([
      await download("same.jar", fabricMod("first", "1")),
    ]);
    await rm(join(dir, "downloads"), { recursive: true });
    const [second] = await lib.add([
      await download("same.jar", fabricMod("second", "1")),
    ]);
    await lib.enable(A, first!.sha1);
    await lib.enable(A, second!.sha1);
    expect(await modsOf(A)).toEqual(
      [`same-${second!.sha1.slice(0, 8)}.jar`, "same.jar"].sort(),
    );
  });

  it("links a mod again when its file was deleted by hand before a sync", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("v.jar", fabricMod("v", "1"))]);
    await lib.enable(A, mod!.sha1);
    await rm(join(paths.modsDir(A), "v.jar"));
    expect(await lib.enable(A, mod!.sha1)).toBe("linked");
    expect(await modsOf(A)).toEqual(["v.jar"]);
  });

  it("never deletes a user's file that replaced a mod's link under the same name", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("u.jar", fabricMod("u", "1"))]);
    await lib.enable(A, mod!.sha1);
    const path = join(paths.modsDir(A), "u.jar");
    await rm(path);
    await writeFile(path, "the user's own file");
    await lib.remove(mod!.sha1);
    expect(await readFile(path, "utf8")).toBe("the user's own file");
  });

  it("keeps what enableAll linked before one of the mods failed", async () => {
    const lib = createModLibrary({ paths });
    const [good] = await lib.add([
      await download("good.jar", fabricMod("good", "1")),
    ]);
    await expect(
      lib.enableAll(A, [good!.sha1, "0".repeat(40)]),
    ).rejects.toMatchObject({ code: "MOD_NOT_FOUND" });
    const reloaded = createModLibrary({ paths });
    expect((await reloaded.list())[0]?.usedBy).toEqual([A]);
    expect(await modsOf(A)).toEqual(["good.jar"]);
  });

  it("counts usage by file identity, so a renamed link still counts", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("x.jar", fabricMod("x", "1"))]);
    await lib.enable(A, mod!.sha1);
    await rename(
      join(paths.modsDir(A), "x.jar"),
      join(paths.modsDir(A), "renamed.jar"),
    );
    await syncAll(lib);
    expect((await lib.list())[0]?.usedBy).toEqual([A]);
    expect(await readdir(paths.modsStoreDir)).toHaveLength(1);
  });

  it("removes links whose stored file is gone", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([
      await download("gone.jar", fabricMod("gone", "1")),
    ]);
    await lib.enable(A, mod!.sha1);
    await rm(paths.modStoreFile(mod!.sha1));
    await syncAll(lib);
    expect(await modsOf(A)).toEqual([]);
    expect(await lib.list()).toEqual([]);
  });

  it("treats a file removed from mods/ by hand as disabled", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("y.jar", fabricMod("y", "1"))]);
    await lib.enable(A, mod!.sha1);
    await rm(join(paths.modsDir(A), "y.jar"));
    await syncAll(lib);
    expect((await lib.list())[0]?.usedBy).toEqual([]);
  });

  it("never touches a profile while its game runs", async () => {
    const lib = createModLibrary({ paths });
    await mkdir(paths.modsDir(A), { recursive: true });
    await writeFile(join(paths.modsDir(A), "busy.jar"), fabricMod("busy", "1"));
    await lib.sync({ profileIds: [A], isRunning: () => true });
    expect(await lib.list()).toEqual([]);
  });

  it("removing a mod takes it out of every profile, but never another file", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("z.jar", fabricMod("z", "1"))]);
    await lib.enable(A, mod!.sha1);
    await writeFile(join(paths.modsDir(A), "mine.jar"), fabricMod("mine", "1"));
    await lib.remove(mod!.sha1);
    expect(await modsOf(A)).toEqual(["mine.jar"]);
  });

  it("forgets a deleted profile's links", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("w.jar", fabricMod("w", "1"))]);
    await lib.enable(A, mod!.sha1);
    await rm(paths.gameDir(A), { recursive: true });
    await lib.sync({ profileIds: [B], isRunning: () => false });
    expect((await lib.list())[0]?.usedBy).toEqual([]);
  });

  it("reads jars again whose metadata an older launcher wrote, keeping their source", async () => {
    const lib = createModLibrary({ paths });
    const jar = fabricJar({
      id: "indium",
      version: "1",
      depends: { sodium: "*" },
    });
    const [mod] = await lib.add([await download("indium.jar", jar)]);
    // As Scope 04 wrote it: no depends, no infoVersion.
    const file = paths.launcherFile("mods.json");
    const data = JSON.parse(await readFile(file, "utf8")) as {
      mods: Record<string, Record<string, unknown>>;
    };
    const old = data.mods[mod!.sha1]!;
    for (const key of ["depends", "size", "infoVersion"])
      Reflect.deleteProperty(old, key);
    old.source = {
      sourceId: "modrinth",
      projectId: "P",
      versionId: "V",
      pageUrl: "https://x",
    };
    await writeFile(file, JSON.stringify(data));

    await syncAll(lib);
    expect(await lib.meta(mod!.sha1)).toMatchObject({
      depends: [{ id: "sodium", range: "*", format: "semver" }],
      size: jar.length,
      infoVersion: INFO_VERSION,
      source: { projectId: "P" },
      addedAt: old.addedAt,
    });
  });

  it("lists a profile's enabled mods with their copies", async () => {
    const lib = createModLibrary({ paths });
    const [mod] = await lib.add([await download("e.jar", fabricMod("e", "1"))]);
    await lib.enable(A, mod!.sha1);
    expect(await lib.enabledMods(A)).toMatchObject([
      { sha1: mod!.sha1, meta: { modId: "e" }, copies: [] },
    ]);
    expect(await lib.enabledMods(B)).toEqual([]);
  });

  it("replaces a damaged stored file and links it again into every profile", async () => {
    const lib = createModLibrary({ paths });
    const jar = fabricMod("r", "1");
    const [mod] = await lib.add([await download("r.jar", jar)]);
    await lib.enable(A, mod!.sha1);
    await lib.enable(B, mod!.sha1);
    await lib.recordVerified([{ sha1: mod!.sha1, size: 1, mtimeMs: 1 }]);
    // Damage it through a profile's hard link: the store file changes with it.
    await writeFile(join(paths.modsDir(A), "r.jar"), "garbage");

    const fresh = await download("fresh.jar", jar);
    await lib.replaceStored(mod!.sha1, fresh);
    const store = paths.modStoreFile(mod!.sha1);
    expect(sha1(await readFile(store))).toBe(mod!.sha1);
    for (const profile of [A, B])
      expect(await sameFile(join(paths.modsDir(profile), "r.jar"), store)).toBe(
        true,
      );
    expect((await lib.meta(mod!.sha1))?.verified).toBeUndefined();

    await expect(
      lib.replaceStored(
        mod!.sha1,
        await download("bad.jar", fabricMod("x", "1")),
      ),
    ).rejects.toMatchObject({ code: "FILE_CHANGED" });
  });
});
