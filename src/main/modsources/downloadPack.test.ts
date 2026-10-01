import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { createPackLibrary, shaderPackKind } from "../profiles/packs/library";
import { downloadPack, SHADER_DOWNLOAD } from "./downloadPack";
import { createFakeModSource } from "./testing/fakeModSource";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-downloadpack-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const packZip = (description: string) =>
  zipSync({
    "pack.mcmeta": strToU8(
      JSON.stringify({ pack: { pack_format: 15, description } }),
    ),
  });
const fresh = packZip("Fresh");
const fresh2 = packZip("Fresh for 1.21");
const notPack = zipSync({ "readme.txt": strToU8("hi") });

function setup() {
  const files = createFakeFetch({
    "https://fake/fresh.zip": fresh,
    "https://fake/fresh2.zip": fresh2,
    "https://fake/bad.zip": notPack,
  });
  const source = createFakeModSource(
    [
      {
        projectId: "fresh",
        name: "Fresh Animations",
        projectType: "resourcepack",
        needs: ["emf"],
      },
      { projectId: "emf", name: "Entity Model Features" },
      { projectId: "bad", name: "Bad", projectType: "resourcepack" },
    ],
    [
      {
        projectId: "fresh",
        versionId: "v2",
        loaders: ["minecraft"],
        gameVersions: ["1.21"],
        sha1: sha1(fresh2),
        size: fresh2.length,
        url: "https://fake/fresh2.zip",
        fileName: "FreshAnimations_v2.zip",
      },
      {
        projectId: "fresh",
        versionId: "v1",
        loaders: ["minecraft"],
        gameVersions: ["1.20.1"],
        sha1: sha1(fresh),
        size: fresh.length,
        url: "https://fake/fresh.zip",
        fileName: "FreshAnimations_v1.zip",
      },
      {
        projectId: "bad",
        versionId: "b1",
        loaders: ["minecraft"],
        gameVersions: ["1.20.1"],
        sha1: sha1(notPack),
        size: notPack.length,
        url: "https://fake/bad.zip",
        fileName: "bad.zip",
      },
    ],
  );
  const downloader = createDownloader({
    fetch: files.fetch,
    userAgent: "test",
  });
  const library = createPackLibrary({ paths });
  return { deps: { downloader, paths, library, source }, library };
}

describe("downloadPack", () => {
  it("downloads the version for the profile's Minecraft version into the library", async () => {
    const { deps, library } = setup();
    const result = await downloadPack(deps, "fresh", { gameVersion: "1.20.1" });
    expect(result).toMatchObject({
      sha1: sha1(fresh),
      otherVersion: false,
      needs: [
        {
          name: "Entity Model Features",
          projectType: "mod",
          pageUrl: "https://fake/mod/emf",
        },
      ],
    });
    expect(await library.list()).toEqual([
      expect.objectContaining({
        name: "FreshAnimations_v1",
        source: {
          sourceId: "fake",
          projectId: "fresh",
          pageUrl: "https://fake/resourcepack/fresh",
        },
      }),
    ]);
  });

  it("takes the newest version when none is tagged for the Minecraft version", async () => {
    const { deps } = setup();
    const result = await downloadPack(deps, "fresh", { gameVersion: "26.3" });
    expect(result).toMatchObject({ sha1: sha1(fresh2), otherVersion: true });
  });

  it("leaves nothing behind when the download isn't a pack", async () => {
    const { deps, library } = setup();
    await expect(
      downloadPack(deps, "bad", { gameVersion: "1.20.1" }),
    ).rejects.toMatchObject({ code: "NOT_A_PACK" });
    expect(await library.list()).toEqual([]);
    expect(await readdir(paths.resourcePacksStoreDir).catch(() => [])).toEqual(
      [],
    );
  });

  it("says when a project has no version at all", async () => {
    const { deps } = setup();
    await expect(downloadPack(deps, "emf")).rejects.toMatchObject({
      code: "PACK_NO_VERSION",
    });
  });
});

describe("downloadPack for shaders", () => {
  const shader = (marker: string) =>
    zipSync({ "shaders/final.fsh": strToU8(`// ${marker}`) });
  const irisNow = shader("iris 26.3");
  const optifineNow = shader("optifine 26.3");
  const irisOld = shader("iris 1.21");

  function shaderSetup() {
    const files = createFakeFetch({
      "https://fake/iris-now.zip": irisNow,
      "https://fake/optifine-now.zip": optifineNow,
      "https://fake/iris-old.zip": irisOld,
    });
    const v = (
      projectId: string,
      versionId: string,
      loaders: string[],
      gameVersions: string[],
      bytes: Uint8Array,
      url: string,
    ) => ({
      projectId,
      versionId,
      loaders,
      gameVersions,
      sha1: sha1(bytes),
      size: bytes.length,
      url,
      fileName: `${versionId}.zip`,
    });
    const source = createFakeModSource(
      [
        { projectId: "both", name: "Both", projectType: "shader" },
        { projectId: "of", name: "OptiFine only", projectType: "shader" },
        { projectId: "old", name: "Old", projectType: "shader" },
      ],
      [
        // Newest first: the OptiFine-only build is newer than the Iris one.
        v(
          "both",
          "b2",
          ["optifine"],
          ["26.3"],
          optifineNow,
          "https://fake/optifine-now.zip",
        ),
        v(
          "both",
          "b1",
          ["iris"],
          ["26.3"],
          irisNow,
          "https://fake/iris-now.zip",
        ),
        v(
          "of",
          "o1",
          ["optifine"],
          ["26.3"],
          optifineNow,
          "https://fake/optifine-now.zip",
        ),
        v(
          "old",
          "x1",
          ["iris"],
          ["1.21"],
          irisOld,
          "https://fake/iris-old.zip",
        ),
      ],
    );
    const downloader = createDownloader({ fetch: files.fetch, userAgent: "t" });
    const library = createPackLibrary({ paths, kind: shaderPackKind(paths) });
    return { deps: { downloader, library, source }, library };
  }

  it("prefers a version tagged for Iris for the Minecraft version", async () => {
    const { deps, library } = shaderSetup();
    const result = await downloadPack(deps, "both", {
      gameVersion: "26.3",
      kind: SHADER_DOWNLOAD,
    });
    expect(result).toMatchObject({ sha1: sha1(irisNow), otherVersion: false });
    expect(await library.list()).toEqual([
      expect.objectContaining({ name: "b1", loaders: ["iris"] }),
    ]);
  });

  it("then any loader for the version, then Iris for another version", async () => {
    const { deps } = shaderSetup();
    const of = await downloadPack(deps, "of", {
      gameVersion: "26.3",
      kind: SHADER_DOWNLOAD,
    });
    expect(of.version.loaders).toEqual(["optifine"]);
    const old = await downloadPack(deps, "old", {
      gameVersion: "26.3",
      kind: SHADER_DOWNLOAD,
    });
    expect(old).toMatchObject({ sha1: sha1(irisOld), otherVersion: true });
  });
});
