import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  packCompat,
  parsePackMcmeta,
  readDataPackFolder,
  readDataPackZip,
  readPackFolder,
  readPackZip,
} from "./packMeta";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-packmeta-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const mcmeta = (pack: unknown) => strToU8(JSON.stringify({ pack }));
const parse = (text: string) => parsePackMcmeta(strToU8(text));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const ANY = Number.MAX_SAFE_INTEGER;

describe("parsePackMcmeta", () => {
  it("reads a single pack_format", () => {
    expect(
      parsePackMcmeta(mcmeta({ pack_format: 15, description: "Hi" })),
    ).toEqual({
      description: "Hi",
      range: { min: { major: 15, minor: 0 }, max: { major: 15, minor: ANY } },
    });
  });

  it("reads every supported_formats style", () => {
    for (const supported of [
      [15, 22],
      { min_inclusive: 15, max_inclusive: 22 },
    ])
      expect(
        parsePackMcmeta(
          mcmeta({ pack_format: 15, supported_formats: supported }),
        )?.range,
      ).toEqual({
        min: { major: 15, minor: 0 },
        max: { major: 22, minor: ANY },
      });
    expect(
      parsePackMcmeta(mcmeta({ pack_format: 18, supported_formats: 18 }))
        ?.range,
    ).toEqual({ min: { major: 18, minor: 0 }, max: { major: 18, minor: ANY } });
  });

  it("reads min_format and max_format with minor versions", () => {
    expect(
      parsePackMcmeta(mcmeta({ min_format: [69, 0], max_format: [75, 1] }))
        ?.range,
    ).toEqual({ min: { major: 69, minor: 0 }, max: { major: 75, minor: 1 } });
    expect(
      parsePackMcmeta(mcmeta({ min_format: 69, max_format: 97 }))?.range,
    ).toEqual({ min: { major: 69, minor: 0 }, max: { major: 97, minor: ANY } });
  });

  it("flattens text component descriptions and drops colour codes", () => {
    expect(
      parsePackMcmeta(
        mcmeta({
          pack_format: 15,
          description: [
            { text: "§6Faithful", bold: true },
            {
              text: " 32x",
              extra: [" — ", { translate: "k", fallback: "v2" }],
            },
          ],
        }),
      )?.description,
    ).toBe("Faithful 32x — v2");
  });

  it("reads files with a BOM, comments and trailing commas", () => {
    expect(
      parse(`\uFEFF{
        // made by hand
        "pack": { "pack_format": 8, /* old */ "description": "a // not a comment", },
      }`),
    ).toEqual({
      description: "a // not a comment",
      range: { min: { major: 8, minor: 0 }, max: { major: 8, minor: ANY } },
    });
  });

  it("still finds pack_format in broken JSON, else gives up", () => {
    expect(
      parse('{"pack": {"pack_format": 6, "description": "x\\"y" '),
    ).toEqual({
      description: 'x"y',
      range: { min: { major: 6, minor: 0 }, max: { major: 6, minor: ANY } },
    });
    expect(parse("not json")).toBeUndefined();
    expect(parse('{"other": 1}')).toBeUndefined();
  });

  it("keeps a pack without any format, with unknown compatibility", () => {
    expect(parse('{"pack": {"description": "no format"}}')).toEqual({
      description: "no format",
    });
  });
});

describe("packCompat", () => {
  const range = {
    min: { major: 69, minor: 0 },
    max: { major: 75, minor: 1 },
  };
  it("compares the game's format with the pack's range", () => {
    expect(packCompat(range, { major: 75, minor: 1 })).toBe("compatible");
    expect(packCompat(range, { major: 75, minor: 2 })).toBe("tooOld");
    expect(packCompat(range, { major: 64, minor: 0 })).toBe("tooNew");
    expect(packCompat(undefined, { major: 75, minor: 0 })).toBe("unknown");
    expect(packCompat(range, undefined)).toBe("unknown");
  });
});

describe("reading packs from disk", () => {
  it("reads a zip pack's metadata and icon", async () => {
    const path = join(dir, "pack.zip");
    await writeFile(
      path,
      zipSync({
        "pack.mcmeta": mcmeta({ pack_format: 15, description: "Zip" }),
        "pack.png": PNG,
        "assets/minecraft/x.png": PNG,
      }),
    );
    const read = await readPackZip(path);
    expect(read).toMatchObject({ status: "ok", meta: { description: "Zip" } });
    expect(read.status === "ok" && read.icon).toEqual(PNG);
  });

  it("drops an icon that isn't a PNG", async () => {
    const path = join(dir, "pack.zip");
    await writeFile(
      path,
      zipSync({
        "pack.mcmeta": mcmeta({ pack_format: 15 }),
        "pack.png": strToU8("not a png"),
      }),
    );
    const read = await readPackZip(path);
    expect(read.status).toBe("ok");
    expect("icon" in read).toBe(false);
  });

  it("explains a zip whose pack.mcmeta is one folder down", async () => {
    const path = join(dir, "nested.zip");
    await writeFile(
      path,
      zipSync({ "Faithful-main/pack.mcmeta": mcmeta({ pack_format: 15 }) }),
    );
    expect(await readPackZip(path)).toEqual({
      status: "nested",
      folder: "Faithful-main",
    });
  });

  it("tells a zip that isn't a pack from one that can't be read", async () => {
    const notPack = join(dir, "photos.zip");
    await writeFile(notPack, zipSync({ "photo.png": PNG }));
    expect(await readPackZip(notPack)).toEqual({ status: "invalid" });
    const broken = join(dir, "broken.zip");
    await writeFile(broken, "not a zip");
    expect(await readPackZip(broken)).toEqual({ status: "unreadable" });
  });

  it("reads folder packs, nested ones too", async () => {
    const folder = join(dir, "My pack");
    await mkdir(folder);
    await writeFile(
      join(folder, "pack.mcmeta"),
      mcmeta({ pack_format: 34, description: "Folder" }),
    );
    await writeFile(join(folder, "pack.png"), PNG);
    expect(await readPackFolder(folder)).toMatchObject({
      status: "ok",
      meta: { description: "Folder" },
      icon: PNG,
    });

    const outer = join(dir, "Download");
    await mkdir(join(outer, "Inner"), { recursive: true });
    await writeFile(join(outer, "Inner", "pack.mcmeta"), mcmeta({}));
    expect(await readPackFolder(outer)).toEqual({
      status: "nested",
      folder: "Inner",
    });
    await mkdir(join(dir, "Empty"));
    expect(await readPackFolder(join(dir, "Empty"))).toEqual({
      status: "invalid",
    });
  });
});

describe("data packs", () => {
  const data = (pack: unknown, extra: Record<string, unknown> = {}) =>
    strToU8(JSON.stringify({ pack, ...extra }));

  it("accepts packs with data/, and reads the features they need", async () => {
    const path = join(dir, "Terralith.zip");
    await writeFile(
      path,
      zipSync({
        "pack.mcmeta": data(
          { pack_format: 48, description: "Worlds" },
          { features: { enabled: ["minecraft:bundle"] } },
        ),
        "data/terralith/worldgen/x.json": strToU8("{}"),
      }),
    );
    expect(await readDataPackZip(path)).toMatchObject({
      status: "ok",
      meta: { description: "Worlds", features: ["minecraft:bundle"] },
    });
  });

  it("says a resource pack (assets/ only) isn't a data pack", async () => {
    const path = join(dir, "Faithful.zip");
    await writeFile(
      path,
      zipSync({
        "pack.mcmeta": data({ pack_format: 15 }),
        "assets/minecraft/x.png": PNG,
      }),
    );
    expect(await readDataPackZip(path)).toEqual({ status: "invalid" });
    expect((await readPackZip(path)).status).toBe("ok");
  });

  it("explains a data pack one folder down, and reads folders", async () => {
    const nested = join(dir, "nested.zip");
    await writeFile(
      nested,
      zipSync({
        "Pack-main/pack.mcmeta": data({ pack_format: 48 }),
        "Pack-main/data/x/y.json": strToU8("{}"),
      }),
    );
    expect(await readDataPackZip(nested)).toEqual({
      status: "nested",
      folder: "Pack-main",
    });

    const folder = join(dir, "Folder pack");
    await mkdir(join(folder, "data"), { recursive: true });
    await writeFile(join(folder, "pack.mcmeta"), data({ pack_format: 48 }));
    expect((await readDataPackFolder(folder)).status).toBe("ok");
    const resource = join(dir, "Resource folder");
    await mkdir(join(resource, "assets"), { recursive: true });
    await writeFile(join(resource, "pack.mcmeta"), data({ pack_format: 15 }));
    expect(await readDataPackFolder(resource)).toEqual({ status: "invalid" });
  });
});
