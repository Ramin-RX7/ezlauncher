import { describe, expect, it } from "vitest";
import { chunkbasePlatform, chunkbaseUrl } from "./chunkbase";
import type { VersionSummary } from "./launcher";

const v = (
  id: string,
  releaseTime: string,
  type = "release",
): VersionSummary => ({
  id,
  type,
  releaseTime,
  installed: false,
});

const versions = [
  v("1.7.2", "2013-10-25T00:00:00Z"),
  v("1.6.4", "2013-09-19T00:00:00Z"),
  v("1.21", "2024-06-13T00:00:00Z"),
  v("1.21.1", "2024-08-08T00:00:00Z"),
  v("1.21.2", "2024-10-22T00:00:00Z"),
  v("1.21.3", "2024-10-23T00:00:00Z"),
  v("1.21.4", "2024-12-03T00:00:00Z"),
  v("1.21.9", "2025-09-30T00:00:00Z"),
  v("1.21.10", "2025-10-07T00:00:00Z"),
  v("26.3", "2026-09-01T00:00:00Z"),
  v("26.3.1", "2026-09-15T00:00:00Z"),
  v("26.4-snapshot-1", "2026-10-01T00:00:00Z", "snapshot"),
  v("26.4", "2026-12-01T00:00:00Z"),
  v("1.21.5-snapshot-1", "2025-01-10T00:00:00Z", "snapshot"),
];

describe("chunkbasePlatform", () => {
  it("maps a version to the Chunkbase range it falls in", () => {
    expect(chunkbasePlatform("1.21.10", false, versions)).toEqual({
      platform: "java_1_21_9",
      approximate: false,
    });
    expect(chunkbasePlatform("1.21.3", false, versions)?.platform).toBe(
      "java_1_21_2",
    );
    expect(chunkbasePlatform("1.21.1", false, versions)?.platform).toBe(
      "java_1_21",
    );
    expect(chunkbasePlatform("1.7.2", false, versions)?.platform).toBe(
      "java_1_7",
    );
  });

  it("adds the Large Biomes suffix", () => {
    expect(chunkbasePlatform("1.21.4", true, versions)?.platform).toBe(
      "java_1_21_4_lb",
    );
  });

  it("gives a snapshot the release before it, marked approximate", () => {
    expect(chunkbasePlatform("1.21.5-snapshot-1", false, versions)).toEqual({
      platform: "java_1_21_4",
      approximate: true,
    });
  });

  it("marks versions newer than the newest Chunkbase one approximate, but not its patches", () => {
    expect(chunkbasePlatform("26.4", false, versions)).toEqual({
      platform: "java_26_3",
      approximate: true,
    });
    expect(chunkbasePlatform("26.3.1", false, versions)).toEqual({
      platform: "java_26_3",
      approximate: false,
    });
  });

  it("has nothing for versions too old or unknown", () => {
    expect(chunkbasePlatform("1.6.4", false, versions)).toBeUndefined();
    expect(chunkbasePlatform("nope", false, versions)).toBeUndefined();
  });
});

describe("chunkbaseUrl", () => {
  it("builds the Seed Map link with a place", () => {
    expect(
      chunkbaseUrl({
        seed: "-3589760978173214155",
        platform: "java_26_3",
        point: { dimension: "nether", x: 114, z: 355 },
      }),
    ).toBe(
      "https://www.chunkbase.com/apps/seed-map#seed=-3589760978173214155&platform=java_26_3&dimension=nether&x=114&z=355",
    );
  });

  it("leaves the place out when there is none", () => {
    expect(chunkbaseUrl({ seed: "42", platform: "java_1_21_4" })).toBe(
      "https://www.chunkbase.com/apps/seed-map#seed=42&platform=java_1_21_4",
    );
  });
});
