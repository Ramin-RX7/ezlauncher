import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@shared/launcher";
import { createLogger } from "../core/logger";
import { createDownloader } from "../minecraft/downloader";
import {
  writeInstallMarker,
  type InstalledVersion,
} from "../minecraft/installer";
import { InstallQueue } from "../minecraft/installQueue";
import type { LoaderInstallRequest } from "../minecraft/loaders/installLoader";
import { createLoaderRegistry } from "../minecraft/loaders/registry";
import { createPaths, type Paths } from "../minecraft/paths";
import { createPatchNotes } from "../minecraft/patchNotes";
import { detectPlatform } from "../minecraft/platform";
import { createFakeFetch } from "../minecraft/testing/fakeFetch";
import { createRuntime } from "./runtime";
import { createVersionService } from "./versions";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-versions-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const profile = (patch: Partial<Profile> = {}): Profile => ({
  id: "p1",
  name: "Survival",
  gameVersion: "1.21.4",
  loader: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

/** A Fabric install of 1.21.4 on disk (marker only). */
const fabricOn = (build: string) =>
  writeInstallMarker(paths, `fabric-loader-${build}-1.21.4`, {
    loader: { id: "fabric", loaderVersion: build, gameVersion: "1.21.4" },
  });

function setup(profiles: Profile[] = []) {
  const runtime = createRuntime();
  const downloader = createDownloader({
    fetch: createFakeFetch().fetch,
    userAgent: "test",
  });
  const fake = (versionId: string) =>
    Promise.resolve({ javaPath: versionId } as unknown as InstalledVersion);
  const calls: string[] = [];
  const install = {
    version: vi.fn(
      (_deps: unknown, versionId: string, { mode }: { mode: string }) => {
        calls.push(`version ${versionId} ${mode}`);
        return fake(versionId);
      },
    ),
    loader: vi.fn(
      (
        _deps: unknown,
        request: LoaderInstallRequest,
        { mode }: { mode: string },
      ) => {
        calls.push(`loader ${request.versionId} ${mode}`);
        return fake(request.versionId);
      },
    ),
    prepareLoader: vi.fn(
      (
        _deps: unknown,
        providerId: string,
        gameVersion: string,
        { loaderVersion = "0.17.0" }: { loaderVersion?: string } = {},
      ) => {
        calls.push(`prepare ${providerId} ${loaderVersion}`);
        return Promise.resolve({
          providerId,
          gameVersion,
          loaderVersion,
          versionId: `fabric-loader-${loaderVersion}-${gameVersion}`,
        });
      },
    ),
  };
  const changed = vi.fn();
  const service = createVersionService({
    paths,
    downloader,
    platform: detectPlatform("linux", "x64", "6.1"),
    loaders: createLoaderRegistry({ downloader }),
    queue: new InstallQueue(() => undefined),
    patchNotes: createPatchNotes({ paths, downloader }),
    profiles: { list: () => Promise.resolve(profiles) },
    runtime,
    whenReady: () => Promise.resolve(),
    afterJava: () => Promise.resolve(),
    install: install as never,
    progress: () => undefined,
    changed,
    logger: createLogger({ console: false }),
  });
  return { service, runtime, calls, changed };
}

describe("createVersionService", () => {
  describe("ensureProfileInstall", () => {
    it("installs a vanilla version once, then only checks it", async () => {
      const { service, calls } = setup();
      const first = await service.ensureProfileInstall(profile());
      expect(first.versionId).toBe("1.21.4");
      await writeInstallMarker(paths, "1.21.4");
      await service.ensureProfileInstall(profile());
      expect(calls).toEqual(["version 1.21.4 install", "version 1.21.4 quick"]);
    });

    it("reuses an existing install of the profile's loader", async () => {
      await fabricOn("0.16.0");
      const { service, calls } = setup();
      const { versionId } = await service.ensureProfileInstall(
        profile({ loader: { id: "fabric" } }),
      );
      expect(versionId).toBe("fabric-loader-0.16.0-1.21.4");
      expect(calls).toEqual(["loader fabric-loader-0.16.0-1.21.4 quick"]);
    });

    it("installs a pinned build that isn't there yet, even beside another build", async () => {
      await fabricOn("0.16.0");
      const { service, calls } = setup();
      const { versionId } = await service.ensureProfileInstall(
        profile({ loader: { id: "fabric", version: "0.17.2" } }),
      );
      expect(versionId).toBe("fabric-loader-0.17.2-1.21.4");
      expect(calls).toEqual([
        "prepare fabric 0.17.2",
        "loader fabric-loader-0.17.2-1.21.4 install",
      ]);
    });

    it("stays on the install a profile already has", async () => {
      await fabricOn("0.15.0");
      await fabricOn("0.16.0");
      const { service, calls } = setup();
      const { versionId } = await service.ensureProfileInstall(
        profile({
          loader: { id: "fabric" },
          installedVersionId: "fabric-loader-0.15.0-1.21.4",
        }),
      );
      expect(versionId).toBe("fabric-loader-0.15.0-1.21.4");
      expect(calls).toEqual(["loader fabric-loader-0.15.0-1.21.4 quick"]);
    });
  });

  it("lists who plays each version, also through a loader built on it", async () => {
    await writeInstallMarker(paths, "1.21.4");
    await fabricOn("0.16.0");
    const { service } = setup([
      profile({ installedVersionId: "fabric-loader-0.16.0-1.21.4" }),
    ]);
    const list = await service.api.installedVersions();
    expect(list.find((v) => v.id === "1.21.4")).toMatchObject({
      usedBy: ["p1"],
    });
    expect(
      list.find((v) => v.id === "fabric-loader-0.16.0-1.21.4"),
    ).toMatchObject({ usedBy: ["p1"] });
  });

  it("deletes a version in use only with force, and never while it plays", async () => {
    await writeInstallMarker(paths, "1.21.4");
    const { service, runtime, changed } = setup([
      profile({ installedVersionId: "1.21.4" }),
    ]);
    await expect(
      service.api.deleteVersion("1.21.4", false),
    ).rejects.toMatchObject({ code: "VERSION_IN_USE" });
    runtime.running.set("l1", {
      launchId: "l1",
      profileId: "p1",
      accountId: "a1",
      versionId: "1.21.4",
      pid: 1,
    });
    await expect(
      service.api.deleteVersion("1.21.4", true),
    ).rejects.toMatchObject({ code: "GAME_RUNNING" });
    await expect(service.api.repairVersion("1.21.4")).rejects.toMatchObject({
      code: "GAME_RUNNING",
    });
    runtime.running.clear();
    await service.api.deleteVersion("1.21.4", true);
    expect(await service.api.installedVersions()).toEqual([]);
    expect(changed).toHaveBeenCalled();
  });

  it("refuses loaders it doesn't know", () => {
    const { service } = setup();
    expect(() => {
      service.validateLoader({ id: "forge" });
    }).toThrow(expect.objectContaining({ code: "LOADER_UNKNOWN" }));
    expect(() => {
      service.validateLoader({ id: "fabric" });
    }).not.toThrow();
    expect(() => {
      service.validateLoader(null);
    }).not.toThrow();
  });
});
