import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "./downloader";
import { deleteVersion, installVersion, isInstalled } from "./installer";
import { createPaths, type Paths } from "./paths";
import { detectPlatform } from "./platform";

import { fakeMojang } from "./testing/fakeMojang";

const platform = detectPlatform("linux", "x64", "6.1");

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
    await deleteVersion(paths, "1.0");
    expect(await isInstalled(paths, "1.0")).toBe(false);
    await expect(stat(paths.versionDir("1.0"))).rejects.toThrow();
    await expect(
      stat(paths.library("com/example/lib/1.0/lib-1.0.jar")),
    ).resolves.toBeTruthy();
  });
});
