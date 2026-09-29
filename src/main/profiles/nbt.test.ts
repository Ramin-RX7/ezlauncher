import { describe, expect, it } from "vitest";
import { readLevelInfo } from "./nbt";
import { makeLevelDat } from "./testing/levelDat";

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
