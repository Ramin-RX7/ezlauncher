import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareFormats,
  formatFromVersionJson,
  legacyFormat,
  optionsDialect,
  predatesResourcePacks,
  readGameFormat,
} from "./packFormat";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-packformat-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("formatFromVersionJson", () => {
  // Real values from the client jars of these versions.
  it("reads all three shapes of version.json", () => {
    expect(
      formatFromVersionJson({ world_version: 1976, pack_version: 4 }),
    ).toEqual({ resource: { major: 4, minor: 0 }, worldVersion: 1976 });
    expect(
      formatFromVersionJson({
        world_version: 3465,
        pack_version: { resource: 15, data: 15 },
      }),
    ).toEqual({ resource: { major: 15, minor: 0 }, worldVersion: 3465 });
    expect(
      formatFromVersionJson({
        world_version: 5023,
        pack_version: {
          resource_major: 97,
          resource_minor: 1,
          data_major: 121,
          data_minor: 0,
        },
      }),
    ).toEqual({ resource: { major: 97, minor: 1 }, worldVersion: 5023 });
  });

  it("returns nothing for files without a pack version", () => {
    expect(formatFromVersionJson({ id: "x" })).toBeUndefined();
    expect(formatFromVersionJson(null)).toBeUndefined();
    expect(formatFromVersionJson({ pack_version: "4" })).toBeUndefined();
  });
});

describe("legacy versions", () => {
  it("knows the formats of 1.6 to 1.13.2", () => {
    expect(legacyFormat("1.6.4")?.resource.major).toBe(1);
    expect(legacyFormat("1.8.9")?.resource.major).toBe(1);
    expect(legacyFormat("1.10.2")?.resource.major).toBe(2);
    expect(legacyFormat("1.12.2")?.resource.major).toBe(3);
    expect(legacyFormat("1.13.2")).toEqual({
      resource: { major: 4, minor: 0 },
      worldVersion: 1631,
    });
    expect(legacyFormat("1.12.2")?.worldVersion).toBeUndefined();
  });

  it("leaves everything else to the jar", () => {
    for (const id of ["1.14.4", "1.5.2", "26.3", "18w43a", "b1.7.3"])
      expect(legacyFormat(id)).toBeUndefined();
  });

  it("knows which releases still used texture packs", () => {
    expect(predatesResourcePacks("1.5.2")).toBe(true);
    expect(predatesResourcePacks("1.6.1")).toBe(false);
    expect(predatesResourcePacks("26.3")).toBe(false);
  });
});

describe("readGameFormat", () => {
  it("prefers the client jar, then the legacy table", async () => {
    const modern = join(dir, "26.3.jar");
    await writeFile(
      modern,
      zipSync({
        "version.json": strToU8(
          JSON.stringify({
            world_version: 5023,
            pack_version: { resource_major: 97, resource_minor: 1 },
          }),
        ),
      }),
    );
    expect(await readGameFormat(modern, "26.3")).toEqual({
      resource: { major: 97, minor: 1 },
      worldVersion: 5023,
    });
    const old = join(dir, "1.8.9.jar");
    await writeFile(old, zipSync({ "pack.png": strToU8("png") }));
    expect((await readGameFormat(old, "1.8.9"))?.resource.major).toBe(1);
    expect(await readGameFormat(join(dir, "missing.jar"), "26.3")).toBe(
      undefined,
    );
  });
});

describe("helpers", () => {
  it("compares formats by major, then minor", () => {
    expect(
      compareFormats({ major: 97, minor: 1 }, { major: 97, minor: 0 }),
    ).toBeGreaterThan(0);
    expect(
      compareFormats({ major: 34, minor: 0 }, { major: 97, minor: 0 }),
    ).toBeLessThan(0);
  });

  it("uses file/ entries from 1.13 (format 4) on", () => {
    expect(optionsDialect({ major: 3, minor: 0 })).toBe("legacy");
    expect(optionsDialect({ major: 4, minor: 0 })).toBe("modern");
  });
});
