import { describe, expect, it } from "vitest";
import { compareVersions, isPrerelease, isSemver } from "./semver";

describe("compareVersions", () => {
  it("orders releases and pre-releases", () => {
    const sorted = [
      "0.2.0",
      "0.10.0",
      "0.2.1",
      "1.0.0-beta.2",
      "1.0.0-alpha",
      "1.0.0",
      "1.0.0-beta.10",
      "1.0.0-beta",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "0.2.0",
      "0.2.1",
      "0.10.0",
      "1.0.0-alpha",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.10",
      "1.0.0",
    ]);
  });

  it("treats equal versions as equal, with or without a v", () => {
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0+build.5", "0.2.0")).toBe(0);
  });

  it("refuses what isn't a version", () => {
    expect(() => compareVersions("1.21.4", "0.2")).toThrow();
    expect(isSemver("26.4-snapshot-1")).toBe(false);
  });

  it("knows pre-releases", () => {
    expect(isPrerelease("0.3.0-beta.1")).toBe(true);
    expect(isPrerelease("0.3.0")).toBe(false);
  });
});
