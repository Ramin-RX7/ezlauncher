import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJson } from "../../core/fsAtomic";
import { createDownloader } from "../downloader";
import {
  installVersion,
  isInstalled,
  listDependents,
  readInstallMarker,
} from "../installer";
import { getVersionList } from "../manifest";
import { createPaths, type Paths } from "../paths";
import { detectPlatform } from "../platform";
import { versionJsonSchema } from "../schemas";
import { sha1 } from "../testing/fakeFetch";
import { fakeMojang } from "../testing/fakeMojang";
import { FABRIC_META_URL } from "./fabric";
import { installLoader, prepareLoader } from "./installLoader";
import { QUILT_META_URL } from "./quilt";
import { createLoaderRegistry } from "./registry";

const platform = detectPlatform("linux", "x64", "6.1");
const FABRIC_ID = "fabric-loader-0.2.0-1.0";
const QUILT_ID = "quilt-loader-0.3.0-1.0";
const FABRIC_MAVEN = "https://maven.fabricmc.net/";
const QUILT_MAVEN = "https://maven.quiltmc.org/repository/release/";
const fabricJarUrl = `${FABRIC_MAVEN}net/fabricmc/fabric-loader/0.2.0/fabric-loader-0.2.0.jar`;
const newLibUrl = `${FABRIC_MAVEN}com/example/lib/2.0/lib-2.0.jar`;
const quiltJarUrl = `${QUILT_MAVEN}org/quiltmc/quilt-loader/0.3.0/quilt-loader-0.3.0.jar`;
const hashlessUrl = `${QUILT_MAVEN}org/quiltmc/hashless/1.0/hashless-1.0.jar`;

/** Fake Mojang plus fake Fabric and Quilt servers for Minecraft `1.0`. */
function fakeServers() {
  const fake = fakeMojang();
  const fabricJar = "fabric-loader-bytes";
  const newLib = "lib-2-bytes";
  const quiltJar = "quilt-loader-bytes";
  const hashless = "hashless-bytes";
  Object.assign(fake.routes, {
    [`${FABRIC_META_URL}/versions/game`]: JSON.stringify([
      { version: "1.0", stable: true },
    ]),
    [`${FABRIC_META_URL}/versions/loader/1.0`]: JSON.stringify([
      { loader: { version: "0.3.0-beta", stable: false } },
      { loader: { version: "0.2.0", stable: true } },
    ]),
    [`${FABRIC_META_URL}/versions/loader/1.0/0.2.0/profile/json`]:
      JSON.stringify({
        id: FABRIC_ID,
        inheritsFrom: "1.0",
        type: "release",
        releaseTime: "2030-01-01T00:00:00+00:00",
        mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
        arguments: { game: [], jvm: ["-DFabricMcEmu= x "] },
        libraries: [
          {
            name: "net.fabricmc:fabric-loader:0.2.0",
            url: FABRIC_MAVEN,
            sha1: sha1(fabricJar),
            size: fabricJar.length,
          },
          // Replaces vanilla's com.example:lib:1.0.
          {
            name: "com.example:lib:2.0",
            url: FABRIC_MAVEN,
            sha1: sha1(newLib),
            size: newLib.length,
          },
        ],
      }),
    [fabricJarUrl]: fabricJar,
    [newLibUrl]: newLib,

    [`${QUILT_META_URL}/versions/loader/1.0`]: JSON.stringify([
      { loader: { version: "0.3.0" } },
      { loader: { version: "0.4.0-beta.1" } },
      { loader: { version: "0.2.9" } },
    ]),
    [`${QUILT_META_URL}/versions/loader/1.0/0.3.0/profile/json`]:
      JSON.stringify({
        id: QUILT_ID,
        inheritsFrom: "1.0",
        mainClass: "org.quiltmc.loader.impl.launch.knot.KnotClient",
        libraries: [
          { name: "org.quiltmc:quilt-loader:0.3.0", url: QUILT_MAVEN },
          { name: "org.quiltmc:hashless:1.0", url: QUILT_MAVEN },
        ],
      }),
    [quiltJarUrl]: quiltJar,
    [`${quiltJarUrl}.sha1`]: `${sha1(quiltJar)}  quilt-loader-0.3.0.jar\n`,
    [hashlessUrl]: hashless,
  });
  return fake;
}

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-loader-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const fake = fakeServers();
  const downloader = createDownloader({
    fetch: fake.fetch,
    userAgent: "t",
    retries: 0,
  });
  const loaders = createLoaderRegistry({ downloader });
  return { fake, deps: { paths, downloader, platform, loaders } };
}

async function installFabric(deps: ReturnType<typeof setup>["deps"]) {
  const request = await prepareLoader(deps, "fabric", "1.0");
  return installLoader(deps, request, { mode: "install" });
}

describe("prepareLoader", () => {
  it("picks the latest stable build and learns the version id", async () => {
    const { deps } = setup();
    const request = await prepareLoader(deps, "fabric", "1.0");
    expect(request).toMatchObject({
      loaderVersion: "0.2.0",
      versionId: FABRIC_ID,
    });
  });

  it("uses a pinned build without asking for the latest", async () => {
    const { deps, fake } = setup();
    const request = await prepareLoader(deps, "quilt", "1.0", {
      loaderVersion: "0.3.0",
    });
    expect(request).toMatchObject({
      loaderVersion: "0.3.0",
      versionId: QUILT_ID,
    });
    expect(fake.requests).not.toContain(
      `${QUILT_META_URL}/versions/loader/1.0`,
    );
  });
});

describe("listLoaderVersions", () => {
  it("lists builds newest first with their stability", async () => {
    const { deps } = setup();
    expect(await deps.loaders.get("fabric").listLoaderVersions("1.0")).toEqual([
      { version: "0.3.0-beta", stable: false },
      { version: "0.2.0", stable: true },
    ]);
    expect(await deps.loaders.get("quilt").listLoaderVersions("1.0")).toEqual([
      { version: "0.4.0-beta.1", stable: false },
      { version: "0.3.0", stable: true },
      { version: "0.2.9", stable: true },
    ]);
  });
});

describe("installLoader", () => {
  it("installs vanilla too, then the loader, and marks both installed", async () => {
    const { deps } = setup();
    const installed = await installFabric(deps);

    expect(await isInstalled(paths, "1.0")).toBe(true);
    expect(await readInstallMarker(paths, FABRIC_ID)).toMatchObject({
      loader: { id: "fabric", loaderVersion: "0.2.0", gameVersion: "1.0" },
    });
    expect(installed.version.mainClass).toContain("KnotClient");
    // The loader's library replaced vanilla's; the vanilla jar is shared.
    const classpath = installed.libraries.classpath.map((t) => t.dest);
    expect(classpath).toContain(
      paths.library("com/example/lib/2.0/lib-2.0.jar"),
    );
    expect(classpath).not.toContain(
      paths.library("com/example/lib/1.0/lib-1.0.jar"),
    );
    expect(installed.clientJar).toBe(paths.clientJar("1.0"));
  });

  it("on an installed vanilla version, downloads only the loader's files", async () => {
    const { fake, deps } = setup();
    await installVersion(deps, "1.0", { mode: "install" });
    fake.requests.length = 0;

    await installFabric(deps);
    expect(fake.requests.sort()).toEqual(
      [
        `${FABRIC_META_URL}/versions/loader/1.0`,
        `${FABRIC_META_URL}/versions/loader/1.0/0.2.0/profile/json`,
        fabricJarUrl,
        newLibUrl,
      ].sort(),
    );
  });

  it("launches an installed loader with no network", async () => {
    const { fake, deps } = setup();
    await installFabric(deps);
    fake.setOffline(true);
    fake.requests.length = 0;

    const installed = await installLoader(
      deps,
      {
        providerId: "fabric",
        gameVersion: "1.0",
        loaderVersion: "0.2.0",
        versionId: FABRIC_ID,
      },
      { mode: "quick" },
    );
    expect(fake.requests).toEqual([]);
    expect(installed.version.id).toBe(FABRIC_ID);
  });

  it("repairs on the installed build, not the newest one", async () => {
    const { fake, deps } = setup();
    await installFabric(deps);
    fake.routes[`${FABRIC_META_URL}/versions/loader/1.0`] = JSON.stringify([
      { loader: { version: "0.9.0", stable: true } },
    ]);
    fake.requests.length = 0;

    await installLoader(
      deps,
      {
        providerId: "fabric",
        gameVersion: "1.0",
        loaderVersion: "0.2.0",
        versionId: FABRIC_ID,
      },
      { mode: "repair" },
    );
    expect(fake.requests).toContain(
      `${FABRIC_META_URL}/versions/loader/1.0/0.2.0/profile/json`,
    );
    expect(fake.requests).not.toContain(
      `${FABRIC_META_URL}/versions/loader/1.0`,
    );
    expect(
      (await readInstallMarker(paths, FABRIC_ID))?.loader?.loaderVersion,
    ).toBe("0.2.0");
  });

  it("verifies Quilt libraries with their .sha1 file and records the ones without", async () => {
    const { deps } = setup();
    const request = await prepareLoader(deps, "quilt", "1.0");
    expect(request.loaderVersion).toBe("0.3.0"); // not the beta, not 0.2.9
    await installLoader(deps, request, { mode: "install" });

    const saved = await readJson(
      paths.versionJson(QUILT_ID),
      versionJsonSchema,
    );
    expect(saved?.libraries?.[0]?.sha1).toBe(sha1("quilt-loader-bytes"));
    expect(saved?.libraries?.[1]?.sha1).toBeUndefined();
    expect((await readInstallMarker(paths, QUILT_ID))?.unverified).toEqual([
      "org.quiltmc:hashless:1.0",
    ]);
    expect(
      await readFile(
        paths.library("org/quiltmc/hashless/1.0/hashless-1.0.jar"),
        "utf8",
      ),
    ).toBe("hashless-bytes");
  });

  it("rejects a library that doesn't match its .sha1 file", async () => {
    const { fake, deps } = setup();
    fake.routes[quiltJarUrl] = "tampered";
    const request = await prepareLoader(deps, "quilt", "1.0");
    await expect(
      installLoader(deps, request, { mode: "install" }),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    expect(await isInstalled(paths, QUILT_ID)).toBe(false);
  });

  it("writes no marker when a loader download fails", async () => {
    const { fake, deps } = setup();
    Reflect.deleteProperty(fake.routes, fabricJarUrl);
    await expect(installFabric(deps)).rejects.toMatchObject({
      code: "DOWNLOAD_FAILED",
    });
    expect(await isInstalled(paths, FABRIC_ID)).toBe(false);
    expect(await isInstalled(paths, "1.0")).toBe(true); // vanilla finished before
  });

  it("reports progress under the loader's version id", async () => {
    const { deps } = setup();
    const request = await prepareLoader(deps, "fabric", "1.0");
    const ids = new Set<string>();
    await installLoader(deps, request, {
      mode: "install",
      onProgress: (p) => ids.add(p.versionId),
    });
    expect([...ids]).toEqual([FABRIC_ID]);
  });
});

describe("installed loader versions", () => {
  it("are listed next to their Minecraft version, with their loader", async () => {
    const { deps } = setup();
    await installFabric(deps);
    const list = await getVersionList(deps);
    expect(list.versions.map((v) => v.id)).toEqual(["1.0", FABRIC_ID]);
    expect(list.versions[1]).toMatchObject({
      type: "release",
      releaseTime: "2020-01-01T00:00:00+00:00", // the game's, not the loader build's
      loader: { id: "fabric", gameVersion: "1.0" },
    });
  });

  it("count as dependents of their Minecraft version", async () => {
    const { deps } = setup();
    await installFabric(deps);
    expect(await listDependents(paths, "1.0")).toEqual([FABRIC_ID]);
    expect(await listDependents(paths, FABRIC_ID)).toEqual([]);
  });
});
