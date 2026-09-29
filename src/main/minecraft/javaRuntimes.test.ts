import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../core/fsAtomic";
import type { Downloader } from "./downloader";
import {
  isJavaComponent,
  javaMajor,
  listJavaRuntimes,
  removeJavaRuntime,
} from "./javaRuntimes";
import { createPaths, type Paths } from "./paths";
import { detectPlatform } from "./platform";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-java-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const windows = detectPlatform("win32", "x64", "10.0");
const manifest = { sha1: "x", size: 1, url: "https://m" };
const all = {
  "windows-x64": {
    "java-runtime-delta": [{ manifest, version: { name: "21.0.7" } }],
    "jre-legacy": [{ manifest, version: { name: "8u51" } }],
    "minecraft-java-exe": [{ manifest, version: { name: "1" } }],
    "java-runtime-alpha": [],
  },
};
const online = { fetchText: () => Promise.resolve(JSON.stringify(all)) };
const offline = { fetchText: () => Promise.reject(new Error("offline")) };

async function installRuntime(component: string, versionName: string) {
  await mkdir(paths.runtimeDir(component), { recursive: true });
  await writeJsonAtomic(paths.runtimeManifest(component), {
    files: {
      "bin/javaw.exe": {
        type: "file",
        downloads: { raw: { sha1: "a", size: 300, url: "https://f" } },
      },
      "lib/x": {
        type: "file",
        downloads: { raw: { sha1: "b", size: 200, url: "https://f" } },
      },
      bin: { type: "directory" },
    },
  });
  await writeJsonAtomic(paths.runtimeMarker(component), {
    schema: 1,
    component,
    platform: "windows-x64",
    versionName,
    installedAt: "2026-09-01T00:00:00Z",
  });
}

describe("javaMajor", () => {
  it.each([
    ["21.0.7", 21],
    ["17", 17],
    ["1.8.0_392", 8],
    ["8u51", 8],
    ["11.0.2", 11],
  ])("%s → %d", (v, major) => {
    expect(javaMajor(v)).toBe(major);
  });

  it("skips components that aren't Java", () => {
    expect(isJavaComponent("minecraft-java-exe")).toBe(false);
    expect(isJavaComponent("jre-legacy")).toBe(true);
  });
});

describe("listJavaRuntimes", () => {
  it("merges installed runtimes with what Mojang offers, newest first", async () => {
    await installRuntime("jre-legacy", "8u51");
    const { runtimes, offline: isOffline } = await listJavaRuntimes({
      paths,
      downloader: online as unknown as Downloader,
      platform: windows,
    });
    expect(isOffline).toBe(false);
    expect(runtimes).toEqual([
      {
        component: "java-runtime-delta",
        versionName: "21.0.7",
        major: 21,
        installed: false,
        available: true,
        usedBy: [],
      },
      {
        component: "jre-legacy",
        versionName: "8u51",
        major: 8,
        installed: true,
        available: true,
        sizeBytes: 500,
        usedBy: [],
      },
    ]);
  });

  it("still lists installed runtimes offline", async () => {
    await installRuntime("java-runtime-gamma", "17.0.8");
    const res = await listJavaRuntimes({
      paths,
      downloader: offline as unknown as Downloader,
      platform: windows,
    });
    expect(res.offline).toBe(true);
    expect(
      res.runtimes.map((r) => [r.component, r.installed, r.available]),
    ).toEqual([["java-runtime-gamma", true, false]]);
  });

  it("removes a runtime completely", async () => {
    await installRuntime("jre-legacy", "8u51");
    await removeJavaRuntime(paths, "jre-legacy");
    await expect(stat(paths.runtimeDir("jre-legacy"))).rejects.toThrow();
  });
});
