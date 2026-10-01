import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPaths, type Paths } from "../../minecraft/paths";
import { sameFile } from "../links";
import { createPackLibrary, shaderPackKind, type PackLibrary } from "./library";
import { createProfileShaders } from "./profileShaders";

let dir: string;
let paths: Paths;
let library: PackLibrary;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-shaders-"));
  paths = createPaths(dir);
  library = createPackLibrary({ paths, kind: shaderPackKind(paths) });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FABRIC = { id: "fabric" };
const P = { id: "p", loader: FABRIC };
const Q = { id: "q", loader: FABRIC };
const VANILLA = { id: "v", loader: null };
const shaders = () => createProfileShaders({ paths, library });
const syncAll = () =>
  library.sync({ profileIds: ["p", "q"], isRunning: () => false });
const idle = { running: false, hasIris: true };

const shaderZip = (marker: string) =>
  zipSync({ "shaders/final.fsh": strToU8(`// ${marker}`) });

async function addShader(name: string) {
  await mkdir(join(dir, "downloads"), { recursive: true });
  const path = join(dir, "downloads", name);
  await writeFile(path, shaderZip(name));
  const [result] = await library.add([path]);
  if (!result?.ok) throw new Error("not added");
  return result.sha1;
}

const config = (id = "p") =>
  readFile(paths.irisConfigFile(id), "latin1").catch(() => undefined);

describe("shader library", () => {
  it("refuses zips without shaders/", async () => {
    await mkdir(join(dir, "downloads"), { recursive: true });
    const path = join(dir, "downloads", "Pack.zip");
    await writeFile(path, zipSync({ "pack.mcmeta": strToU8("{}") }));
    expect(await library.add([path])).toEqual([
      { ok: false, fileName: "Pack.zip", code: "NOT_A_SHADER" },
    ]);
  });

  it("adopts a shader zip dropped into a profile by hand", async () => {
    await mkdir(paths.shaderPacksDir("p"), { recursive: true });
    await writeFile(
      join(paths.shaderPacksDir("p"), "Hand.zip"),
      shaderZip("h"),
    );
    const { adopted } = await syncAll();
    expect(adopted).toBe(1);
    const view = await shaders().view(P, idle);
    expect(view.inProfile.map((s) => s.name)).toEqual(["Hand"]);
  });

  it("stores two profiles' copies of one shader once", async () => {
    const sha1 = await addShader("A.zip");
    await shaders().add(P, sha1);
    await shaders().add(Q, sha1);
    expect(
      await sameFile(
        join(paths.shaderPacksDir("p"), "A.zip"),
        join(paths.shaderPacksDir("q"), "A.zip"),
      ),
    ).toBe(true);
  });
});

describe("profile shaders", () => {
  it("makes a library shader active, linking it first", async () => {
    const sha1 = await addShader("My Pack.zip");
    await shaders().setActive(P, { kind: "library", sha1 });
    expect(await config()).toContain("shaderPack=My Pack.zip");
    expect(await config()).toContain("enableShaders=true");
    const view = await shaders().view(P, idle);
    expect(view.active).toEqual({ kind: "library", sha1 });
    expect(view.inProfile).toHaveLength(1);
    expect(view.available).toEqual([]);
  });

  it("keeps the other lines of Iris's config and backs it up once", async () => {
    const original =
      "#Iris\r\ncolorSpace=SRGB\r\nenableShaders=true\r\nshaderPack=Old.zip\r\n";
    await mkdir(join(paths.gameDir("p"), "config"), { recursive: true });
    await writeFile(paths.irisConfigFile("p"), original);
    const sha1 = await addShader("New.zip");
    await shaders().setActive(P, { kind: "library", sha1 });
    await shaders().setActive(P, null);
    expect(await config()).toBe(
      "#Iris\r\ncolorSpace=SRGB\r\nenableShaders=false\r\nshaderPack=New.zip\r\n",
    );
    expect(await readFile(paths.irisConfigBackup("p"), "latin1")).toBe(
      original,
    );
  });

  it("turning shaders off shows none active but keeps the shader", async () => {
    const sha1 = await addShader("A.zip");
    await shaders().setActive(P, { kind: "library", sha1 });
    await shaders().setActive(P, null);
    const view = await shaders().view(P, idle);
    expect(view.active).toBeUndefined();
    expect(view.inProfile).toHaveLength(1);
  });

  it("uses folder shaders and lists folders one level too deep", async () => {
    await mkdir(join(paths.shaderPacksDir("p"), "Folder", "shaders"), {
      recursive: true,
    });
    await mkdir(join(paths.shaderPacksDir("p"), "Outer", "Inner", "shaders"), {
      recursive: true,
    });
    await shaders().setActive(P, { kind: "folder", name: "Folder" });
    const view = await shaders().view(P, idle);
    expect(view.active).toEqual({ kind: "folder", name: "Folder" });
    expect(view.notPacks).toEqual([
      { name: "Outer", reason: "nested", folder: "Inner" },
    ]);
    await expect(
      shaders().setActive(P, { kind: "folder", name: "Outer" }),
    ).rejects.toMatchObject({ code: "SHADER_NOT_FOUND" });
  });

  it("removing the active shader turns it off and keeps its options", async () => {
    const sha1 = await addShader("A.zip");
    await shaders().setActive(P, { kind: "library", sha1 });
    await writeFile(paths.shaderOptionsFile("p", "A.zip"), "SHADOWS=false\n");
    await shaders().remove(P, sha1);
    const view = await shaders().view(P, idle);
    expect(view.active).toBeUndefined();
    expect(view.inProfile).toEqual([]);
    expect(view.available).toHaveLength(1);
    expect(await config()).not.toContain("shaderPack");
    expect(await readFile(paths.shaderOptionsFile("p", "A.zip"), "utf8")).toBe(
      "SHADOWS=false\n",
    );
  });

  it("follows a shader renamed by hand, with its options", async () => {
    const sha1 = await addShader("A.zip");
    await shaders().setActive(P, { kind: "library", sha1 });
    await writeFile(paths.shaderOptionsFile("p", "A.zip"), "X=1\n");
    await rename(
      join(paths.shaderPacksDir("p"), "A.zip"),
      join(paths.shaderPacksDir("p"), "B.zip"),
    );
    const { diffs } = await syncAll();
    const diff = diffs.get("p");
    if (!diff) throw new Error("no diff");
    await shaders().followSync(P, diff);
    expect(await config()).toContain("shaderPack=B.zip");
    expect(await readFile(paths.shaderOptionsFile("p", "B.zip"), "utf8")).toBe(
      "X=1\n",
    );
    expect((await shaders().view(P, idle)).active).toEqual({
      kind: "library",
      sha1,
    });
  });

  it("copies shaders, their options and the active one to a duplicate", async () => {
    const a = await addShader("A.zip");
    const b = await addShader("B.zip");
    await shaders().add(P, a);
    await shaders().setActive(P, { kind: "library", sha1: b });
    await writeFile(paths.shaderOptionsFile("p", "A.zip"), "A=1\n");
    await writeFile(paths.shaderOptionsFile("p", "B.zip"), "B=1\n");
    await mkdir(join(paths.shaderPacksDir("p"), "Folder", "shaders"), {
      recursive: true,
    });
    await shaders().copyTo(P, Q);
    const view = await shaders().view(Q, idle);
    expect(view.inProfile.map((s) => s.name)).toEqual(["A", "B", "Folder"]);
    expect(view.active).toEqual({ kind: "library", sha1: b });
    expect(await readFile(paths.shaderOptionsFile("q", "B.zip"), "utf8")).toBe(
      "B=1\n",
    );
  });

  it("locks vanilla and running profiles and reports Iris", async () => {
    expect(
      await shaders().view(VANILLA, { running: false, hasIris: false }),
    ).toMatchObject({ iris: "noLoader", locked: "noLoader" });
    expect(
      await shaders().view(P, { running: true, hasIris: false }),
    ).toMatchObject({ iris: "missing", locked: "running" });
    await expect(shaders().setActive(VANILLA, null)).rejects.toMatchObject({
      code: "SHADERS_NEED_LOADER",
    });
  });
});
