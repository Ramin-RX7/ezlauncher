import { describe, expect, it } from "vitest";
import { createDownloader } from "../downloader";
import { createFakeFetch } from "../testing/fakeFetch";
import {
  compareLoaderVersions,
  createQuiltProvider,
  pickQuiltLoader,
  QUILT_META_URL,
} from "./quilt";

describe("compareLoaderVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareLoaderVersions("0.26.10", "0.26.9")).toBeGreaterThan(0);
    expect(compareLoaderVersions("0.9", "0.26.0")).toBeLessThan(0);
    expect(compareLoaderVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("pickQuiltLoader", () => {
  it("takes the highest stable version from an unsorted list", () => {
    expect(
      pickQuiltLoader([
        "0.26.9",
        "0.27.0-beta.1",
        "0.26.10",
        "0.26.11-pre.2",
        "0.25.0",
      ]),
    ).toBe("0.26.10");
  });

  it("returns undefined when only pre-releases exist", () => {
    expect(pickQuiltLoader(["0.1.0-beta.1", "0.1.0-pre.1"])).toBeUndefined();
    expect(pickQuiltLoader([])).toBeUndefined();
  });
});

describe("Quilt provider", () => {
  const setup = (routes: Record<string, string>) =>
    createQuiltProvider({
      downloader: createDownloader({
        fetch: createFakeFetch(routes).fetch,
        userAgent: "t",
        retries: 0,
      }),
    });

  it("lists supported Minecraft versions", async () => {
    const quilt = setup({
      [`${QUILT_META_URL}/versions/game`]: JSON.stringify([
        { version: "1.20.1", stable: true },
        { version: "23w31a", stable: false },
      ]),
    });
    expect(await quilt.listGameVersions()).toEqual(["1.20.1", "23w31a"]);
  });

  it("fails clearly for a version with no stable build", async () => {
    const quilt = setup({
      [`${QUILT_META_URL}/versions/loader/1.12.2`]: "[]",
    });
    await expect(quilt.getLatestLoaderVersion("1.12.2")).rejects.toMatchObject({
      code: "LOADER_UNSUPPORTED",
    });
  });
});
