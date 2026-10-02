import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../core/logger";
import { writeInstallMarker } from "../minecraft/installer";
import { createPaths, type Paths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { createStorageService, type StorageDeps } from "./storage";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-storage-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, body: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

function setup(overrides: Partial<StorageDeps> = {}) {
  const deleted: string[] = [];
  const removeUnused = vi.fn(() => Promise.resolve(1));
  const deps: StorageDeps = {
    paths,
    platform: detectPlatform("linux", "x64", "6.1"),
    logger: createLogger({ console: false }),
    libraries: [
      {
        list: () =>
          Promise.resolve([
            { name: "Unused mod", size: 1000, usedBy: [] },
            { name: "Used mod", size: 5000, usedBy: ["p1"] },
          ]),
        removeUnused,
      },
    ],
    installedVersions: () =>
      Promise.resolve([
        { id: "1.20.1", usedBy: [], dependents: ["fabric-loader-1-1.20.1"] },
        { id: "fabric-loader-1-1.20.1", usedBy: ["p1"], dependents: [] },
        { id: "1.12.2", usedBy: [], dependents: [] },
      ]),
    deleteVersion: (id) => {
      deleted.push(id);
      return rm(paths.versionDir(id), { recursive: true, force: true });
    },
    removeJava: (c) =>
      rm(paths.runtimeDir(c), { recursive: true, force: true }),
    orphanBackupFolders: () => Promise.resolve(["Gone World"]),
    profileIds: () => Promise.resolve(["p1", "p2"]),
    isBusy: (id) => id === "p2",
    busy: () => false,
    serialFs: (fn) => fn(),
    progress: () => undefined,
    ...overrides,
  };
  return { service: createStorageService(deps), deleted, removeUnused };
}

describe("storage service", () => {
  it("plans each clean-up with what it frees", async () => {
    await put(paths.clientJar("1.12.2"), "x".repeat(200));
    await put(join(paths.backupDir("Gone World"), "a.zip"), "b".repeat(50));
    await put(join(dir, "modpack-backups", "p9", "u.zip"), "m".repeat(30));
    await put(join(paths.gameDir("p1"), "logs", "latest.log"), "keep");
    await put(join(paths.gameDir("p1"), "logs", "2026-01-01-1.log.gz"), "ll");
    await put(join(paths.gameDir("p1"), "crash-reports", "c.txt"), "ccc");
    await put(join(paths.gameDir("p2"), "logs", "old.log"), "running");

    const report = await setup().service.scan();
    const byId = Object.fromEntries(report.cleanups.map((c) => [c.id, c]));
    expect(byId.libraryItems).toMatchObject({ bytes: 1000, count: 1 });
    // 1.20.1 is the base of a used loader install: kept.
    expect(byId.versions?.items).toEqual([{ label: "1.12.2", bytes: 200 }]);
    expect(byId.backups?.items.map((i) => i.label).sort()).toEqual([
      "backups/Gone World/",
      "modpack-backups/p9/",
    ]);
    // latest.log stays; the profile that's playing is skipped.
    expect(byId.logs?.items.map((i) => i.label).sort()).toEqual([
      "crash-reports/c.txt",
      "logs/2026-01-01-1.log.gz",
    ]);
    expect(report.totalBytes).toBeGreaterThan(0);
  });

  it("frees Java a removed version needed, in one go", async () => {
    // 1.12.2 is the only version naming java-runtime-alpha.
    await put(
      paths.versionJson("1.12.2"),
      JSON.stringify({
        id: "1.12.2",
        javaVersion: { component: "jre-legacy", majorVersion: 8 },
      }),
    );
    await writeInstallMarker(paths, "1.12.2");
    await put(
      join(paths.runtimeDir("jre-legacy"), "bin", "java"),
      "j".repeat(9),
    );
    const { service, deleted, removeUnused } = setup();
    const result = await service.clean(["versions", "java", "libraryItems"]);
    expect(deleted).toEqual(["1.12.2"]);
    expect(removeUnused).toHaveBeenCalled();
    expect(await readdir(paths.runtimesDir)).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.freedBytes).toBeGreaterThan(0);
  });

  it("doesn't touch game files while installs run", async () => {
    const report = await setup({ busy: () => true }).service.scan();
    expect(report.cleanups.find((c) => c.id === "gameFiles")).toMatchObject({
      available: false,
      reason: "busy",
    });
  });
});
