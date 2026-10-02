import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha1 } from "../minecraft/testing/fakeFetch";
import { extractOverrides, readMrpack } from "./readMrpack";
import { packIndex, writeMrpack } from "./testing/makeMrpack";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-mrpack-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readMrpack", () => {
  it("reads the index and lists the overrides", async () => {
    const file = join(dir, "p.mrpack");
    await writeMrpack(file, packIndex(), {
      "overrides/config/a.json": "{}",
      "client-overrides/options.txt": "fov:1",
      "server-overrides/server.properties": "x",
    });
    const contents = await readMrpack(file);
    expect(contents.index.name).toBe("Test Pack");
    expect(contents.overrides.map((o) => o.path).sort()).toEqual([
      "config/a.json",
      "options.txt",
    ]);
  });

  it("refuses files that aren't packs", async () => {
    const file = join(dir, "p.mrpack");
    await writeFile(file, "not a zip");
    await expect(readMrpack(file)).rejects.toMatchObject({
      code: "MODPACK_INVALID",
    });
    await writeMrpack(file, { hello: 1 });
    await expect(readMrpack(file)).rejects.toMatchObject({
      code: "MODPACK_INVALID",
    });
  });

  it("refuses overrides that leave the folder", async () => {
    const file = join(dir, "p.mrpack");
    await writeMrpack(file, packIndex(), { "overrides/../evil.txt": "x" });
    await expect(readMrpack(file)).rejects.toMatchObject({
      code: "MODPACK_UNSAFE_PATH",
    });
  });
});

describe("extractOverrides", () => {
  it("unpacks overrides, client overrides win, and existing files are replaced", async () => {
    const file = join(dir, "p.mrpack");
    await writeMrpack(file, packIndex(), {
      "client-overrides/config/a.json": "client",
      "overrides/config/a.json": "common",
      "overrides/config/b.json": "b",
      "server-overrides/config/c.json": "server",
    });
    const game = join(dir, "game");
    await mkdir(join(game, "config"), { recursive: true });
    await writeFile(join(game, "config", "b.json"), "old");
    const written = await extractOverrides(file, game);
    expect(await readFile(join(game, "config", "a.json"), "utf8")).toBe(
      "client",
    );
    expect(await readFile(join(game, "config", "b.json"), "utf8")).toBe("b");
    expect(Object.fromEntries(written)).toEqual({
      "config/a.json": sha1("client"),
      "config/b.json": sha1("b"),
    });
  });

  it("leaves out what `accept` refuses", async () => {
    const file = join(dir, "p.mrpack");
    await writeMrpack(file, packIndex(), {
      "overrides/saves/W/level.dat": "w",
      "overrides/config/a.json": "a",
    });
    const game = join(dir, "game");
    const written = await extractOverrides(file, game, {
      accept: (p) => !p.startsWith("saves/"),
    });
    expect([...written.keys()]).toEqual(["config/a.json"]);
  });
});
