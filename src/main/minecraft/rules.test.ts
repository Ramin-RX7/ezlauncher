import { describe, expect, it } from "vitest";
import { detectPlatform } from "./platform";
import { rulesAllow } from "./rules";

const windows = { platform: detectPlatform("win32", "x64", "10.0.22631") };
const mac = { platform: detectPlatform("darwin", "arm64", "23.1.0") };
const linux32 = { platform: detectPlatform("linux", "ia32", "6.1.0") };

describe("rulesAllow", () => {
  it("allows when there are no rules", () => {
    expect(rulesAllow(undefined, windows)).toBe(true);
    expect(rulesAllow([], windows)).toBe(true);
  });

  it("is disallowed by default when rules exist but none match", () => {
    expect(
      rulesAllow([{ action: "allow", os: { name: "osx" } }], windows),
    ).toBe(false);
    expect(rulesAllow([{ action: "allow", os: { name: "osx" } }], mac)).toBe(
      true,
    );
  });

  it("lets the last matching rule win (allow all, then disallow one OS)", () => {
    const rules = [
      { action: "allow" as const },
      { action: "disallow" as const, os: { name: "osx" } },
    ];
    expect(rulesAllow(rules, windows)).toBe(true);
    expect(rulesAllow(rules, mac)).toBe(false);
  });

  it("matches arch and os version regex", () => {
    expect(
      rulesAllow([{ action: "allow", os: { arch: "x86" } }], linux32),
    ).toBe(true);
    expect(
      rulesAllow([{ action: "allow", os: { arch: "x86" } }], windows),
    ).toBe(false);
    const win10 = [
      { action: "allow" as const, os: { name: "windows", version: "^10\\." } },
    ];
    expect(rulesAllow(win10, windows)).toBe(true);
  });

  it("treats an invalid version regex as not matching", () => {
    expect(
      rulesAllow([{ action: "allow", os: { version: "([" } }], windows),
    ).toBe(false);
  });

  it("matches features, with missing features counting as false", () => {
    const demo = [
      { action: "allow" as const, features: { is_demo_user: true } },
    ];
    expect(rulesAllow(demo, windows)).toBe(false);
    expect(
      rulesAllow(demo, { ...windows, features: { is_demo_user: true } }),
    ).toBe(true);
    const notDemo = [
      { action: "allow" as const, features: { is_demo_user: false } },
    ];
    expect(rulesAllow(notDemo, windows)).toBe(true);
  });
});
