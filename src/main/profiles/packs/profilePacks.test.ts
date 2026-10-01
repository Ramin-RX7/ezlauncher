import {
  appendFile,
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
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPaths, type Paths } from "../../minecraft/paths";
import { sha1 } from "../../minecraft/testing/fakeFetch";
import { sameFile } from "../links";
import { createPackLibrary, type PackLibrary } from "./library";
import type { GameFormat } from "./packFormat";
import { createProfilePacks } from "./profilePacks";

let dir: string;
let paths: Paths;
let library: PackLibrary;
let format: GameFormat | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-packs-"));
  paths = createPaths(dir);
  library = createPackLibrary({ paths });
  format = { resource: { major: 97, minor: 1 }, worldVersion: 5023 };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const P = { id: "p", gameVersion: "26.3" };
const Q = { id: "q", gameVersion: "26.3" };
const packs = () =>
  createProfilePacks({
    paths,
    library,
    gameFormat: () => Promise.resolve(format),
  });
const syncAll = () =>
  library.sync({ profileIds: ["p", "q"], isRunning: () => false });

function packZip(
  description: string,
  pack: object = { min_format: 90, max_format: 100 },
) {
  return zipSync({
    "pack.mcmeta": strToU8(JSON.stringify({ pack: { description, ...pack } })),
  });
}

/** A pack zip somewhere outside the data folder, as picked in a file dialog. */
async function download(name: string, bytes: Uint8Array) {
  await mkdir(join(dir, "downloads"), { recursive: true });
  const path = join(dir, "downloads", name);
  await writeFile(path, bytes);
  return path;
}

async function addPack(name: string, description = name) {
  const [result] = await library.add([
    await download(name, packZip(description)),
  ]);
  if (!result?.ok) throw new Error("not added");
  return result.sha1;
}

const optionsOf = async (id = "p") =>
  readFile(paths.optionsFile(id), "utf8").catch(() => undefined);
const packLine = async (id = "p") =>
  (await optionsOf(id))
    ?.split(/\r?\n/)
    .find((l) => l.startsWith("resourcePacks:"));

describe("pack library", () => {
  it("stores a pack once and refuses zips that aren't packs", async () => {
    const results = await library.add([
      await download("A.zip", packZip("Pack A")),
      await download("photos.zip", zipSync({ "photo.png": strToU8("x") })),
      await download(
        "nested.zip",
        zipSync({ "inner/pack.mcmeta": strToU8("{}") }),
      ),
    ]);
    expect(results.map((r) => (r.ok ? "ok" : r.code))).toEqual([
      "ok",
      "NOT_A_PACK",
      "PACK_NESTED",
    ]);
    expect(await library.list()).toEqual([
      expect.objectContaining({
        name: "A",
        description: "Pack A",
        usedBy: [],
        checked: false,
      }),
    ]);
  });

  it("adopts pack zips dropped into resourcepacks/, but no other zips", async () => {
    await mkdir(paths.resourcePacksDir("p"), { recursive: true });
    const dropped = join(paths.resourcePacksDir("p"), "Dropped.zip");
    // Built once: a zip holds the time it was made, so a second build can differ.
    const bytes = packZip("dropped");
    await writeFile(dropped, bytes);
    await writeFile(
      join(paths.resourcePacksDir("p"), "Photos.zip"),
      zipSync({ "a.png": strToU8("x") }),
    );
    const { adopted } = await syncAll();
    expect(adopted).toBe(1);
    expect(
      await sameFile(dropped, paths.resourcePackStoreFile(sha1(bytes))),
    ).toBe(true);
    expect((await packs().view(P, { running: false })).notPacks).toEqual([
      { name: "Photos.zip", reason: "invalid" },
    ]);
  });

  it("stores a zip edited in place under its new hash, keeping its links", async () => {
    const old = await addPack("Edit.zip");
    await packs().setActive(P, [{ kind: "library", sha1: old }]);
    const linked = join(paths.resourcePacksDir("p"), "Edit.zip");
    await appendFile(linked, "extra bytes"); // edits the stored file through the link
    await syncAll();
    const list = await library.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.sha1).not.toBe(old);
    expect(list[0]!.usedBy).toEqual(["p"]);
    expect(
      await sameFile(linked, paths.resourcePackStoreFile(list[0]!.sha1)),
    ).toBe(true);
  });
});

describe("a profile's active packs", () => {
  it("writes options.txt lowest priority first and reads it back highest first", async () => {
    const a = await addPack("A.zip");
    const b = await addPack("B.zip");
    await packs().setActive(P, [
      { kind: "library", sha1: b },
      { kind: "library", sha1: a },
    ]);
    expect(await optionsOf()).toBe(
      'version:5023\r\nresourcePacks:["file/A.zip","file/B.zip"]\r\nincompatibleResourcePacks:[]\r\n'.replace(
        /\r\n/g,
        process.platform === "win32" ? "\r\n" : "\n",
      ),
    );
    const view = await packs().view(P, { running: false });
    expect(
      view.active.map((r) => (r.kind === "pack" ? r.pack.name : r.id)),
    ).toEqual(["B", "A"]);
    expect(view.available).toEqual([]);
    expect(
      await sameFile(
        join(paths.resourcePacksDir("p"), "A.zip"),
        paths.resourcePackStoreFile(a),
      ),
    ).toBe(true);
  });

  it("keeps the game's other settings and built-in packs, and backs the file up once", async () => {
    const a = await addPack("A.zip");
    await mkdir(paths.gameDir("p"), { recursive: true });
    const original =
      'version:5023\r\nao:true\r\nresourcePacks:["programmer_art","file/Gone.zip"]\r\nincompatibleResourcePacks:[]\r\nfov:0.5\r\n';
    await writeFile(paths.optionsFile("p"), original);

    const view = await packs().view(P, { running: false });
    expect(view.active).toEqual([{ kind: "builtin", id: "programmer_art" }]);
    await packs().setActive(P, [
      { kind: "library", sha1: a },
      { kind: "builtin", id: "programmer_art" },
    ]);
    expect(await optionsOf()).toBe(
      original.replace(
        '["programmer_art","file/Gone.zip"]',
        '["programmer_art","file/A.zip"]',
      ),
    );
    expect(await readFile(paths.optionsBackup("p"), "utf8")).toBe(original);
    await packs().setActive(P, []);
    expect(await readFile(paths.optionsBackup("p"), "utf8")).toBe(original);
    expect(await packLine()).toBe("resourcePacks:[]");
  });

  it("lists only packs known to be incompatible as incompatible", async () => {
    const [old] = await library.add([
      await download("Old.zip", packZip("old", { pack_format: 34 })),
    ]);
    const [noFormat] = await library.add([
      await download("NoFormat.zip", packZip("no format", {})),
    ]);
    if (!old?.ok || !noFormat?.ok) throw new Error("not added");
    const view = await packs().view(P, { running: false });
    expect(
      Object.fromEntries(view.available.map((p) => [p.name, p.compat])),
    ).toEqual({
      NoFormat: "unknown",
      Old: "tooOld",
    });
    await packs().setActive(P, [
      { kind: "library", sha1: old.sha1 },
      { kind: "library", sha1: noFormat.sha1 },
    ]);
    expect(await optionsOf()).toContain(
      'incompatibleResourcePacks:["file/Old.zip"]',
    );
  });

  it("unlinks a library pack that is no longer active", async () => {
    const a = await addPack("A.zip");
    await packs().setActive(P, [{ kind: "library", sha1: a }]);
    await packs().setActive(P, []);
    expect(await readdir(paths.resourcePacksDir("p"))).toEqual([]);
    expect((await library.list())[0]?.usedBy).toEqual([]);
  });

  it("follows a pack file renamed by hand", async () => {
    const a = await addPack("A.zip");
    await packs().setActive(P, [{ kind: "library", sha1: a }]);
    await rename(
      join(paths.resourcePacksDir("p"), "A.zip"),
      join(paths.resourcePacksDir("p"), "A renamed.zip"),
    );
    const { diffs } = await syncAll();
    await packs().followSync(P, diffs.get("p")!);
    expect(await packLine()).toBe('resourcePacks:["file/A renamed.zip"]');
    const view = await packs().view(P, { running: false });
    expect(view.active).toHaveLength(1);
  });

  it("activates folder packs, which stay in the profile", async () => {
    const folder = paths.folderPackDir("p", "My folder");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "pack.mcmeta"),
      JSON.stringify({ pack: { pack_format: 97, description: "folder" } }),
    );
    const view = await packs().view(P, { running: false });
    expect(view.available).toEqual([
      expect.objectContaining({ ref: { kind: "folder", name: "My folder" } }),
    ]);
    await packs().setActive(P, [{ kind: "folder", name: "My folder" }]);
    expect(await packLine()).toBe('resourcePacks:["file/My folder"]');
    expect(await library.list()).toEqual([]);
  });

  it("names packs without file/ before 1.13", async () => {
    format = { resource: { major: 1, minor: 0 } };
    const a = await addPack("A.zip");
    await packs().setActive({ id: "p", gameVersion: "1.8.9" }, [
      { kind: "library", sha1: a },
    ]);
    expect(await optionsOf()).toBe(
      [
        'resourcePacks:["A.zip"]',
        'incompatibleResourcePacks:["A.zip"]',
        "",
      ].join(process.platform === "win32" ? "\r\n" : "\n"),
    );
  });

  it("refuses when the version's format is unknown, or it predates resource packs", async () => {
    const a = await addPack("A.zip");
    format = undefined;
    await expect(
      packs().setActive(P, [{ kind: "library", sha1: a }]),
    ).rejects.toMatchObject({ code: "PACKS_VERSION_UNKNOWN" });
    expect((await packs().view(P, { running: false })).locked).toBe(
      "versionUnknown",
    );
    const old = { id: "p", gameVersion: "1.5.2" };
    await expect(packs().setActive(old, [])).rejects.toMatchObject({
      code: "PACKS_UNSUPPORTED",
    });
    expect((await packs().view(old, { running: true })).locked).toBe(
      "unsupported",
    );
    format = { resource: { major: 97, minor: 1 } };
    expect((await packs().view(P, { running: true })).locked).toBe("running");
  });
});

describe("duplicating and changing versions", () => {
  it("copies the active packs to a new profile, mapping renamed links", async () => {
    const a = await addPack("A.zip", "first");
    await rm(join(dir, "downloads"), { recursive: true });
    const b = await addPack("A.zip", "second"); // same file name, other pack
    await packs().setActive(P, [
      { kind: "library", sha1: a },
      { kind: "library", sha1: b },
    ]);
    // Q already has another "A.zip" file of its own.
    await mkdir(paths.resourcePacksDir("q"), { recursive: true });
    await writeFile(join(paths.resourcePacksDir("q"), "A.zip"), "user's file");

    await packs().copyActive(P, Q);
    const line = await packLine("q");
    const pLine = await packLine("p");
    expect(pLine).toBe(
      `resourcePacks:["file/A-${b.slice(0, 8)}.zip","file/A.zip"]`,
    );
    expect(line).toBe(
      `resourcePacks:["file/A-${b.slice(0, 8)}.zip","file/A-${a.slice(0, 8)}.zip"]`,
    );
    expect((await stat(join(paths.resourcePacksDir("q"), "A.zip"))).size).toBe(
      11,
    );
  });

  it("rewrites entries when the version moves across 1.13", async () => {
    await mkdir(paths.gameDir("p"), { recursive: true });
    await writeFile(
      paths.optionsFile("p"),
      'resourcePacks:["programmer_art","file/A.zip"]\nincompatibleResourcePacks:[]\n',
    );
    await packs().translate(P, "modern", "legacy");
    expect(await packLine()).toBe('resourcePacks:["A.zip"]');
    await packs().translate(P, "legacy", "modern");
    expect(await packLine()).toBe('resourcePacks:["file/A.zip"]');
  });
});
