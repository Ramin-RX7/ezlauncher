import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDownloader, type FetchFn } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { createJavaService } from "./java";
import { createRuntime } from "./runtime";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-java-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(fetch: FetchFn, installing = false) {
  const runtime = createRuntime();
  const service = createJavaService({
    paths,
    downloader: createDownloader({ fetch, userAgent: "test", retries: 0 }),
    platform: detectPlatform("linux", "x64", "6.1"),
    queue: { isAnyBusy: () => installing },
    runtime,
    whenReady: () => Promise.resolve(),
    progress: () => undefined,
  });
  return { service, runtime };
}

const offline: FetchFn = () => Promise.reject(new TypeError("fetch failed"));

describe("createJavaService", () => {
  it("refuses unknown runtimes, a data move and busy installs", async () => {
    const { service, runtime } = setup(offline);
    await expect(service.api.installJava("not-java")).rejects.toMatchObject({
      code: "JAVA_UNAVAILABLE",
    });
    await expect(service.api.removeJava("not-java")).rejects.toMatchObject({
      code: "JAVA_UNAVAILABLE",
    });
    runtime.moving = true;
    await expect(
      service.api.installJava("java-runtime-delta"),
    ).rejects.toMatchObject({ code: "BUSY" });

    const installing = setup(offline, true);
    await expect(
      installing.service.api.installJava("java-runtime-delta"),
    ).rejects.toMatchObject({ code: "BUSY" });
    await expect(
      installing.service.api.removeJava("java-runtime-delta"),
    ).rejects.toMatchObject({ code: "BUSY" });
  });

  it("runs one install at a time; version installs wait for it, even when it fails", async () => {
    let fail!: () => void;
    const gate = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const { service } = setup(async () => {
      await gate;
      throw new TypeError("fetch failed");
    });
    await expect(service.afterJava()).resolves.toBeUndefined();

    const install = service.api.installJava("java-runtime-delta");
    await vi.waitFor(() => {
      expect(service.isBusy()).toBe(true);
    });
    await expect(
      service.api.installJava("java-runtime-gamma"),
    ).rejects.toMatchObject({ code: "BUSY" });
    let waited = false;
    const after = service.afterJava().then(() => {
      waited = true;
    });
    expect(waited).toBe(false);

    fail();
    await expect(install).rejects.toBeDefined();
    await after;
    expect(waited).toBe(true);
    expect(service.isBusy()).toBe(false);
  });
});
