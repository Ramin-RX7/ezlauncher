import { describe, expect, it } from "vitest";
import { matchesFabricRange } from "./fabricRange";
import { matchesMavenRange } from "./mavenRange";
import { parseMcVersion } from "./mcVersion";
import { compareSemVer, parseSemVer } from "./semver";

const mc = (id: string) => {
  const v = parseMcVersion(id);
  if (!v) throw new Error(`not a release: ${id}`);
  return v;
};

describe("parseMcVersion", () => {
  it("reads release ids, old and new style", () => {
    expect(parseMcVersion("1.18.2")).toEqual({ nums: [1, 18, 2] });
    expect(parseMcVersion("1.21")).toEqual({ nums: [1, 21] });
    expect(parseMcVersion("26.3")).toEqual({ nums: [26, 3] });
  });

  it("maps pre-releases, release candidates and new-style snapshots to their release", () => {
    expect(parseMcVersion("1.21-pre1")).toEqual({
      nums: [1, 21],
      pre: "beta.1",
    });
    expect(parseMcVersion("1.20.5-rc2")).toEqual({
      nums: [1, 20, 5],
      pre: "rc.2",
    });
    expect(parseMcVersion("26.4-snapshot-1")).toEqual({
      nums: [26, 4],
      pre: "alpha.1",
    });
    // Before the release, after the one before.
    expect(matchesFabricRange(">=1.21", mc("1.21-pre1"))).toBe(false);
    expect(matchesFabricRange("~1.21-", mc("1.21-rc1"))).toBe(true);
    expect(matchesFabricRange(">1.20.6", mc("1.21-pre1"))).toBe(true);
  });

  it("maps weekly snapshots to the next release, using the manifest", () => {
    const manifest = [
      { id: "1.18.2", type: "release", releaseTime: "2022-02-28T10:00:00Z" },
      { id: "22w13a", type: "snapshot", releaseTime: "2022-03-31T10:00:00Z" },
      {
        id: "1.19-pre1",
        type: "snapshot",
        releaseTime: "2022-05-18T10:00:00Z",
      },
      { id: "1.19", type: "release", releaseTime: "2022-06-07T10:00:00Z" },
      { id: "1.19.1", type: "release", releaseTime: "2022-07-27T10:00:00Z" },
    ];
    const v = parseMcVersion("22w13a", manifest);
    expect(v).toEqual({ nums: [1, 19], pre: "alpha.22.13.a" });
    expect(compareSemVer(v!, mc("1.19-pre1"))).toBeLessThan(0);
    expect(compareSemVer(v!, mc("1.18.2"))).toBeGreaterThan(0);
  });

  it("leaves what it can't place unknown", () => {
    expect(parseMcVersion("24w14a")).toBeUndefined(); // no manifest
    expect(parseMcVersion("24w14a", [])).toBeUndefined();
    expect(parseMcVersion("3D Shareware v1.34")).toBeUndefined();
    expect(parseMcVersion("b1.7.3")).toBeUndefined();
  });
});

describe("semver compare", () => {
  const cmp = (a: string, b: string) =>
    Math.sign(compareSemVer(parseSemVer(a)!, parseSemVer(b)!));
  it("orders numbers, missing parts as 0, and pre-releases first", () => {
    expect(cmp("1.18.10", "1.18.9")).toBe(1);
    expect(cmp("1.18", "1.18.0")).toBe(0);
    expect(cmp("1.19-beta.1", "1.19")).toBe(-1);
    expect(cmp("1.19-beta.2", "1.19-beta.10")).toBe(-1);
  });
});

describe("matchesFabricRange", () => {
  it.each([
    ["*", "1.18.2", true],
    ["1.18.2", "1.18.2", true],
    ["1.18.2", "1.18.1", false],
    ["=1.18", "1.18", true],
    [">=1.18.2", "1.20.1", true],
    [">=1.18.2", "1.18.1", false],
    [">1.18", "1.18", false],
    ["<1.19", "1.18.2", true],
    ["<1.19", "1.19", false],
    ["<=1.19", "1.19", true],
    ["1.18.x", "1.18.2", true],
    ["1.18.x", "1.19", false],
    ["1.18.*", "1.18", true],
    ["~1.18.1", "1.18.2", true],
    ["~1.18.1", "1.19", false],
    ["^1.18", "1.21.4", true],
    [">=1.18.2 <1.19", "1.18.2", true],
    [">=1.18.2 <1.19", "1.19", false],
    [">=1.20.5-", "1.20.5", true],
    [">=26.1", "26.3", true],
  ])("%s with %s → %s", (range, version, expected) => {
    expect(matchesFabricRange(range, mc(version))).toBe(expected);
  });

  it("treats a list as any of", () => {
    expect(matchesFabricRange(["1.18.2", "1.19.x"], mc("1.19.2"))).toBe(true);
    expect(matchesFabricRange(["1.18.2", "1.19.x"], mc("1.20"))).toBe(false);
  });

  it("can't read nonsense", () => {
    expect(matchesFabricRange("latest", mc("1.18.2"))).toBeUndefined();
    expect(matchesFabricRange([], mc("1.18.2"))).toBeUndefined();
  });
});

describe("matchesMavenRange", () => {
  it.each([
    ["[1.18,1.19)", "1.18.2", true],
    ["[1.18,1.19)", "1.19", false],
    ["(1.18,1.19]", "1.18", false],
    ["(1.18,1.19]", "1.19", true],
    ["[1.20.1]", "1.20.1", true],
    ["[1.20.1]", "1.20.2", false],
    ["[1.20,)", "26.3", true],
    ["(,1.19]", "1.12.2", true],
    ["[1.16,1.16.5],[1.18,)", "1.17.1", false],
    ["[1.16,1.16.5],[1.18,)", "1.18.2", true],
  ])("%s with %s → %s", (range, version, expected) => {
    expect(matchesMavenRange(range, mc(version))).toBe(expected);
  });

  it("can't check a bare version or nonsense", () => {
    expect(matchesMavenRange("1.18.2", mc("1.18.2"))).toBeUndefined();
    expect(matchesMavenRange("[1.18,", mc("1.18.2"))).toBeUndefined();
    expect(matchesMavenRange("[abc]", mc("1.18.2"))).toBeUndefined();
  });
});
