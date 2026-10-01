import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  entryName,
  mergeIncompatible,
  mergePacks,
  newOptionsText,
  packEntry,
  readPackLists,
  writePackLists,
} from "./gameOptions";

/** The start of an options.txt as Minecraft 26.3 writes it on Windows. */
const GAME_WRITTEN = [
  "version:5023",
  "ao:true",
  "biomeBlendRadius:2",
  'resourcePacks:["programmer_art","file/A.zip"]',
  "incompatibleResourcePacks:[]",
  "lastServer:",
  "key_key.attack:key.mouse.left",
  "",
].join("\r\n");

describe("a real options.txt written by Minecraft 26.3", () => {
  const real = readFileSync(
    join(import.meta.dirname, "testing", "options-26.3.txt"),
    "utf8",
  );

  it("is read, and rewritten with only the pack lines changed", () => {
    expect(readPackLists(real)).toEqual({ packs: [], incompatible: [] });
    const out = writePackLists(real, {
      packs: ["file/A.zip"],
      incompatible: [],
    });
    const before = real.split("\r\n");
    const after = out.split("\r\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toEqual(['resourcePacks:["file/A.zip"]']);
    expect(writePackLists(out, readPackLists(real))).toBe(real);
  });
});

describe("reading and writing the pack lines", () => {
  it("reads both lists", () => {
    expect(readPackLists(GAME_WRITTEN)).toEqual({
      packs: ["programmer_art", "file/A.zip"],
      incompatible: [],
    });
  });

  it("changes only the pack lines, keeping every other byte", () => {
    const out = writePackLists(GAME_WRITTEN, {
      packs: ["programmer_art", "file/B.zip", "file/A.zip"],
      incompatible: ["file/B.zip"],
    });
    expect(out).toBe(
      GAME_WRITTEN.replace(
        'resourcePacks:["programmer_art","file/A.zip"]',
        'resourcePacks:["programmer_art","file/B.zip","file/A.zip"]',
      ).replace(
        "incompatibleResourcePacks:[]",
        'incompatibleResourcePacks:["file/B.zip"]',
      ),
    );
    expect(out.split("\r\n")).toHaveLength(GAME_WRITTEN.split("\r\n").length);
  });

  it("adds missing lines before the final newline, with the file's line endings", () => {
    expect(
      writePackLists("version:1976\nfov:0.0\n", {
        packs: ['file/Ä "q".zip'],
        incompatible: [],
      }),
    ).toBe(
      'version:1976\nfov:0.0\nresourcePacks:["file/Ä \\"q\\".zip"]\nincompatibleResourcePacks:[]\n',
    );
  });

  it("treats a damaged or cut-off list as empty", () => {
    expect(readPackLists('resourcePacks:["file/A.z').packs).toEqual([]);
    expect(readPackLists("").packs).toEqual([]);
    expect(readPackLists('resourcePacks:{"x":1}').packs).toEqual([]);
  });

  it("writes a new file with only the pack lines and a known data version", () => {
    expect(
      newOptionsText({ packs: ["file/A.zip"], incompatible: [] }, 5023, "\r\n"),
    ).toBe(
      'version:5023\r\nresourcePacks:["file/A.zip"]\r\nincompatibleResourcePacks:[]\r\n',
    );
    expect(
      newOptionsText({ packs: ["A.zip"], incompatible: [] }, undefined, "\n"),
    ).toBe('resourcePacks:["A.zip"]\nincompatibleResourcePacks:[]\n');
  });
});

describe("entry names", () => {
  it("uses file/ entries in the modern dialect only", () => {
    expect(packEntry("A.zip", "modern")).toBe("file/A.zip");
    expect(packEntry("A.zip", "legacy")).toBe("A.zip");
    expect(entryName("file/My pack", "modern")).toBe("My pack");
    expect(entryName("programmer_art", "modern")).toBeUndefined();
    expect(entryName("A.zip", "legacy")).toBe("A.zip");
  });
});

describe("mergePacks", () => {
  const managed = (e: string) => e.startsWith("file/");

  it("keeps unmanaged entries in place and refills managed slots in the new order", () => {
    expect(
      mergePacks(
        ["file/A.zip", "programmer_art", "file/B.zip", "fabric"],
        ["file/B.zip", "file/A.zip"],
        managed,
      ),
    ).toEqual(["file/B.zip", "programmer_art", "file/A.zip", "fabric"]);
  });

  it("puts newly active packs at the highest-priority end", () => {
    expect(
      mergePacks(
        ["vanilla", "file/A.zip"],
        ["file/A.zip", "file/New.zip"],
        managed,
      ),
    ).toEqual(["vanilla", "file/A.zip", "file/New.zip"]);
    expect(mergePacks([], ["file/A.zip"], managed)).toEqual(["file/A.zip"]);
  });

  it("drops managed entries that are no longer active", () => {
    expect(
      mergePacks(
        ["file/A.zip", "programmer_art", "file/B.zip"],
        ["file/B.zip"],
        managed,
      ),
    ).toEqual(["file/B.zip", "programmer_art"]);
    expect(mergePacks(["file/A.zip"], [], managed)).toEqual([]);
  });
});

describe("mergeIncompatible", () => {
  it("keeps unmanaged entries and lists exactly the needed managed ones", () => {
    const managed = (e: string) => e === "file/A.zip" || e === "file/B.zip";
    expect(
      mergeIncompatible(
        ["file/Other.zip", "file/A.zip"],
        ["file/B.zip"],
        managed,
      ),
    ).toEqual(["file/Other.zip", "file/B.zip"]);
  });
});
