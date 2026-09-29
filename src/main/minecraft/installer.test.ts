import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "./downloader";
import { deleteVersion, installVersion, isInstalled } from "./installer";
import { JAVA_ALL_URL } from "./java";
import { MANIFEST_URL } from "./manifest";
import { createPaths, type Paths } from "./paths";
import { detectPlatform } from "./platform";
import { createFakeFetch, sha1 } from "./testing/fakeFetch";

const platform = detectPlatform("linux", "x64", "6.1");

/** A tiny fake Mojang: one version with a library, a native jar, assets, logging and Java. */
function fakeMojang() {
  const libJar = "library-bytes";
  const nativeJar = zipSync({
    "liblwjgl.so": strToU8("native"),
    "META-INF/MANIFEST.MF": strToU8("skip me"),
  });
  const clientJar = "client-bytes";
  const logXml = "<log/>";
  const asset1 = "sound-data";
  const asset2 = "lang-data";
  const javaBin = "#!java";
  const assetIndex = JSON.stringify({
    objects: {
      "minecraft/sounds/a.ogg": { hash: sha1(asset1), size: asset1.length },
      "minecraft/lang/en.json": { hash: sha1(asset2), size: asset2.length },
      "minecraft/sounds/copy.ogg": { hash: sha1(asset1), size: asset1.length },
    },
  });
  const runtimeManifest = JSON.stringify({
    files: {
      bin: { type: "directory" },
      "bin/java": {
        type: "file",
        executable: true,
        downloads: {
          raw: {
            url: "https://java/bin/java",
            sha1: sha1(javaBin),
            size: javaBin.length,
          },
        },
      },
      "bin/java-link": { type: "link", target: "java" },
    },
  });
  const javaAll = JSON.stringify({
    linux: {
      "java-runtime-test": [
        {
          manifest: {
            url: "https://java/manifest.json",
            sha1: sha1(runtimeManifest),
            size: runtimeManifest.length,
          },
          version: { name: "21.0.0" },
        },
      ],
    },
  });
  const assetUrl = (d: string) =>
    `https://resources.download.minecraft.net/${sha1(d).slice(0, 2)}/${sha1(d)}`;
  const versionJson = JSON.stringify({
    id: "1.0",
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    javaVersion: { component: "java-runtime-test", majorVersion: 21 },
    assetIndex: {
      id: "idx",
      url: "https://meta/idx.json",
      sha1: sha1(assetIndex),
      size: assetIndex.length,
    },
    downloads: {
      client: {
        url: "https://meta/client.jar",
        sha1: sha1(clientJar),
        size: clientJar.length,
      },
    },
    logging: {
      client: {
        argument: "-Dlog4j.configurationFile=${path}",
        file: {
          id: "client.xml",
          url: "https://meta/client.xml",
          sha1: sha1(logXml),
          size: logXml.length,
        },
      },
    },
    libraries: [
      {
        name: "com.example:lib:1.0",
        downloads: {
          artifact: {
            path: "com/example/lib/1.0/lib-1.0.jar",
            url: "https://libs/lib.jar",
            sha1: sha1(libJar),
            size: libJar.length,
          },
        },
      },
      {
        name: "org.lwjgl:lwjgl-platform:2.9",
        natives: { linux: "natives-linux" },
        extract: { exclude: ["META-INF/"] },
        downloads: {
          classifiers: {
            "natives-linux": {
              path: "org/lwjgl/n.jar",
              url: "https://libs/n.jar",
              sha1: sha1(nativeJar),
              size: nativeJar.length,
            },
          },
        },
      },
    ],
  });
  const manifest = JSON.stringify({
    latest: { release: "1.0", snapshot: "1.0" },
    versions: [
      {
        id: "1.0",
        type: "release",
        url: "https://meta/1.0.json",
        sha1: sha1(versionJson),
        time: "t",
        releaseTime: "2020-01-01T00:00:00+00:00",
      },
    ],
  });

  return createFakeFetch({
    [MANIFEST_URL]: manifest,
    "https://meta/1.0.json": versionJson,
    "https://meta/idx.json": assetIndex,
    "https://meta/client.jar": clientJar,
    "https://meta/client.xml": logXml,
    "https://libs/lib.jar": libJar,
    "https://libs/n.jar": nativeJar,
    [assetUrl(asset1)]: asset1,
    [assetUrl(asset2)]: asset2,
    [JAVA_ALL_URL]: javaAll,
    "https://java/manifest.json": runtimeManifest,
    "https://java/bin/java": javaBin,
  });
}

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-install-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const fake = fakeMojang();
  const downloader = createDownloader({
    fetch: fake.fetch,
    userAgent: "t",
    retries: 0,
  });
  return { fake, deps: { paths, downloader, platform } };
}

describe("installVersion", () => {
  it("installs every file, extracts natives and writes the marker", async () => {
    const { deps } = setup();
    const result = await installVersion(deps, "1.0", { mode: "install" });

    expect(await isInstalled(paths, "1.0")).toBe(true);
    expect(await readFile(paths.clientJar("1.0"), "utf8")).toBe("client-bytes");
    expect(
      await readFile(paths.library("com/example/lib/1.0/lib-1.0.jar"), "utf8"),
    ).toBe("library-bytes");
    expect(await readdir(paths.nativesDir("1.0"))).toEqual(["liblwjgl.so"]);
    expect(result.javaPath).toBe(
      join(paths.runtimeDir("java-runtime-test"), "bin", "java"),
    );
    if (process.platform !== "win32") {
      // Windows doesn't keep Unix permission bits.
      expect((await stat(result.javaPath)).mode & 0o111).not.toBe(0);
    }
    expect(result.libraries.classpath).toHaveLength(1);
  });

  it("relaunching an installed version makes zero network requests", async () => {
    const { fake, deps } = setup();
    await installVersion(deps, "1.0", { mode: "install" });
    fake.requests.length = 0;
    fake.setOffline(true);

    await installVersion(deps, "1.0", { mode: "quick" });
    expect(fake.requests).toEqual([]);
  });

  it("re-downloads only a file that went missing", async () => {
    const { fake, deps } = setup();
    await installVersion(deps, "1.0", { mode: "install" });
    await rm(paths.library("com/example/lib/1.0/lib-1.0.jar"));
    fake.requests.length = 0;

    await installVersion(deps, "1.0", { mode: "quick" });
    expect(fake.requests).toEqual(["https://libs/lib.jar"]);
  });

  it("repair finds a damaged file with the same size", async () => {
    const { fake, deps } = setup();
    await installVersion(deps, "1.0", { mode: "install" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(paths.clientJar("1.0"), "client-bytez"); // same length, wrong content
    fake.requests.length = 0;

    await installVersion(deps, "1.0", { mode: "quick" });
    expect(fake.requests).not.toContain("https://meta/client.jar"); // quick check can't see it
    await installVersion(deps, "1.0", { mode: "repair" });
    expect(fake.requests).toContain("https://meta/client.jar");
    expect(await readFile(paths.clientJar("1.0"), "utf8")).toBe("client-bytes");
  });

  it("does not write the marker when a download fails", async () => {
    const { fake, deps } = setup();
    delete fake.routes["https://libs/lib.jar"];
    await expect(
      installVersion(deps, "1.0", { mode: "install" }),
    ).rejects.toMatchObject({
      code: "DOWNLOAD_FAILED",
    });
    expect(await isInstalled(paths, "1.0")).toBe(false);
  });

  it("delete removes the version folder but keeps shared files and, by default, the game folder", async () => {
    const { deps } = setup();
    await installVersion(deps, "1.0", { mode: "install" });
    await deleteVersion(paths, "1.0", { deleteGameDir: false });
    expect(await isInstalled(paths, "1.0")).toBe(false);
    await expect(stat(paths.versionDir("1.0"))).rejects.toThrow();
    await expect(
      stat(paths.library("com/example/lib/1.0/lib-1.0.jar")),
    ).resolves.toBeTruthy();
  });
});
