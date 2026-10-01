import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDataPackState, readLevelInfo } from "./nbt";
import { makeLevelDat } from "./testing/levelDat";

describe("readDataPackState", () => {
  it("reads a real level.dat written by Minecraft 26.3", () => {
    const real = readFileSync(
      join(import.meta.dirname, "testing", "level-26.3.dat"),
    );
    const state = readDataPackState(new Uint8Array(real));
    expect(state.enabled).toEqual([
      "vanilla",
      "file/Other.zip",
      "file/Spike Pack.zip",
    ]);
    expect(state.disabled).toEqual([
      "minecart_improvements",
      "redstone_experiments",
      "trade_rebalance",
    ]);
    expect(readLevelInfo(new Uint8Array(real)).name).toBeTruthy();
  });

  it("reads the lists and features, and copes with worlds without them", () => {
    const bytes = makeLevelDat("W", 1, {
      enabled: ["vanilla", "file/A.zip"],
      disabled: ["file/B.zip"],
      features: ["minecraft:vanilla", "minecraft:bundle"],
    });
    expect(readDataPackState(bytes)).toEqual({
      enabled: ["vanilla", "file/A.zip"],
      disabled: ["file/B.zip"],
      features: ["minecraft:vanilla", "minecraft:bundle"],
    });
    expect(readLevelInfo(bytes).name).toBe("W");
    expect(readDataPackState(makeLevelDat("Old", 1))).toEqual({
      enabled: [],
      disabled: [],
      features: [],
    });
  });
});

describe("readLevelInfo", () => {
  it("reads the world name and last played time, skipping other tags", () => {
    const info = readLevelInfo(
      makeLevelDat("Mein Schloss ✦", 1_700_000_000_000),
    );
    expect(info).toEqual({
      name: "Mein Schloss ✦",
      lastPlayed: 1_700_000_000_000,
    });
  });

  it("throws on truncated data instead of reading past the end", () => {
    const bytes = makeLevelDat("World", 1);
    expect(() => readLevelInfo(bytes.subarray(0, bytes.length - 8))).toThrow();
    expect(() => readLevelInfo(new Uint8Array([10, 0]))).toThrow();
  });
});
