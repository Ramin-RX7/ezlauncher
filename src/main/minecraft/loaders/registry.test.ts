import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../downloader";
import { createPaths, type Paths } from "../paths";
import { createFakeFetch } from "../testing/fakeFetch";
import { FABRIC_META_URL } from "./fabric";
import { createLoaderRegistry, getSupportedGameVersions } from "./registry";

const GAME_URL = `${FABRIC_META_URL}/versions/game`;

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-loaders-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const fake = createFakeFetch({
    [GAME_URL]: JSON.stringify([{ version: "1.18.2", stable: true }]),
  });
  const registry = createLoaderRegistry({
    downloader: createDownloader({
      fetch: fake.fetch,
      userAgent: "t",
      retries: 0,
    }),
  });
  return { fake, registry, fabric: registry.get("fabric") };
}

describe("loader registry", () => {
  it("lists Fabric and Quilt, and refuses unknown loaders", () => {
    const { registry } = setup();
    expect(registry.providers.map((p) => p.id)).toEqual(["fabric", "quilt"]);
    expect(() => registry.get("forge")).toThrow(
      expect.objectContaining({ code: "LOADER_UNKNOWN" }),
    );
  });
});

describe("getSupportedGameVersions", () => {
  it("fetches once, then uses the saved list with no requests", async () => {
    const { fake, fabric } = setup();
    expect(await getSupportedGameVersions(fabric, paths)).toEqual(["1.18.2"]);
    fake.setOffline(true);
    fake.requests.length = 0;
    expect(await getSupportedGameVersions(fabric, paths)).toEqual(["1.18.2"]);
    expect(fake.requests).toEqual([]);
  });

  it("refreshes on request and keeps the saved list if that fails", async () => {
    const { fake, fabric } = setup();
    await getSupportedGameVersions(fabric, paths);
    fake.routes[GAME_URL] = JSON.stringify([
      { version: "1.21.4" },
      { version: "1.18.2" },
    ]);
    expect(
      await getSupportedGameVersions(fabric, paths, { refresh: true }),
    ).toEqual(["1.21.4", "1.18.2"]);

    fake.setOffline(true);
    expect(
      await getSupportedGameVersions(fabric, paths, { refresh: true }),
    ).toEqual(["1.21.4", "1.18.2"]);
  });

  it("is unknown (null) with no saved list and no network", async () => {
    const { fake, fabric } = setup();
    fake.setOffline(true);
    expect(await getSupportedGameVersions(fabric, paths)).toBeNull();
  });
});
