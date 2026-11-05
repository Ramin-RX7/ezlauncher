import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { TAG, writeNbt, type Compound, type Tag } from "./nbtTree";
import { readHostUuid, readWorldMap } from "./worldMap";

const c = (entries: Record<string, Tag>): Compound => ({
  type: TAG.COMPOUND,
  value: Object.entries(entries),
});
const s = (value: string): Tag => ({ type: TAG.STRING, value });
const i = (value: number): Tag => ({ type: TAG.INT, value });
const b = (value: number): Tag => ({ type: TAG.BYTE, value });
const l = (value: bigint): Tag => ({ type: TAG.LONG, value });
const pos = (x: number, y: number, z: number): Tag => ({
  type: TAG.LIST,
  itemType: TAG.DOUBLE,
  value: [x, y, z].map((value) => ({ type: TAG.DOUBLE, value })),
});
const ints = (...values: number[]): Tag => ({
  type: TAG.INT_ARRAY,
  value: Int32Array.from(values),
});

/** A gzipped `level.dat` with this `Data` compound, as the game writes it. */
const level = (data: Record<string, Tag>) =>
  gzipSync(writeNbt("", c({ Data: c(data) })));

const generator = (type: string, extra: Record<string, Tag> = {}) =>
  c({
    seed: l(-4172144997902289642n),
    dimensions: c({
      "minecraft:overworld": c({
        type: s("minecraft:overworld"),
        generator: c({ type: s(type), ...extra }),
      }),
    }),
  });

describe("readWorldMap", () => {
  it("reads a modern world with its host player in the Nether", () => {
    const info = readWorldMap(
      level({
        Version: c({ Name: s("1.21.4") }),
        WorldGenSettings: generator("minecraft:noise", {
          settings: s("minecraft:overworld"),
        }),
        SpawnX: i(16),
        SpawnZ: i(-32),
        Player: c({
          Dimension: s("minecraft:the_nether"),
          Pos: pos(114.7, 64, -355.2),
          LastDeathLocation: c({
            dimension: s("minecraft:overworld"),
            pos: ints(10, 70, 20),
          }),
        }),
      }),
    );
    expect(info).toEqual({
      seed: "-4172144997902289642",
      version: "1.21.4",
      worldType: "normal",
      spawn: { dimension: "overworld", x: 16, z: -32 },
      playerFound: true,
      player: { dimension: "nether", x: 114, z: -356 },
      lastDeath: { dimension: "overworld", x: 10, z: 20 },
    });
  });

  it("reads an old world: RandomSeed, generatorName and a numeric Dimension", () => {
    const info = readWorldMap(
      level({
        RandomSeed: l(42n),
        generatorName: s("largeBiomes"),
        SpawnX: i(0),
        SpawnZ: i(0),
        Player: c({ Dimension: i(1), Pos: pos(5, 60, 6) }),
      }),
    );
    expect(info.seed).toBe("42");
    expect(info.worldType).toBe("largeBiomes");
    expect(info.player).toEqual({ dimension: "end", x: 5, z: 6 });
    expect(info.lastDeath).toBeUndefined();
  });

  it("tells world types apart", () => {
    const type = (gen: Compound) =>
      readWorldMap(level({ WorldGenSettings: gen })).worldType;
    expect(
      type(
        generator("minecraft:noise", { settings: s("minecraft:large_biomes") }),
      ),
    ).toBe("largeBiomes");
    expect(
      type(
        generator("minecraft:noise", {
          settings: s("minecraft:overworld"),
          biome_source: c({ large_biomes: b(1) }),
        }),
      ),
    ).toBe("largeBiomes");
    expect(
      type(
        generator("minecraft:noise", { settings: s("minecraft:amplified") }),
      ),
    ).toBe("amplified");
    expect(type(generator("minecraft:flat"))).toBe("flat");
    expect(type(generator("terralith:custom"))).toBe("custom");
  });

  it("reads the newer spawn compound", () => {
    const info = readWorldMap(
      level({
        spawn: c({
          dimension: s("minecraft:overworld"),
          pos: ints(-8, 70, 99),
        }),
      }),
    );
    expect(info.spawn).toEqual({ dimension: "overworld", x: -8, z: 99 });
  });

  it("uses a playerdata file only when level.dat has no host player", () => {
    const player = gzipSync(
      writeNbt(
        "",
        c({ Dimension: s("minecraft:overworld"), Pos: pos(1, 2, 3) }),
      ),
    );
    const noHost = level({ RandomSeed: l(1n) });
    expect(readWorldMap(noHost).playerFound).toBe(false);
    expect(readWorldMap(noHost, { player }).player).toEqual({
      dimension: "overworld",
      x: 1,
      z: 3,
    });
    const host = level({ Player: c({ Pos: pos(9, 9, 9) }) });
    expect(readWorldMap(host, { player }).player).toEqual({
      dimension: "overworld",
      x: 9,
      z: 9,
    });
  });

  it("drops odd tags instead of failing", () => {
    const info = readWorldMap(
      level({
        RandomSeed: s("not a number"),
        SpawnX: s("x"),
        Player: c({
          Dimension: s("aether:aether"),
          Pos: pos(1, 2, Number.NaN),
        }),
      }),
      { player: new Uint8Array([1, 2, 3]) },
    );
    expect(info).toEqual({ worldType: "normal", playerFound: true });
  });

  it("ignores a damaged playerdata file", () => {
    const info = readWorldMap(level({}), { player: new Uint8Array([1, 2, 3]) });
    expect(info.playerFound).toBe(false);
  });

  it("reads a 26.x world: seed in world_gen_settings.dat, player in players/data", () => {
    const levelDat = level({
      Version: c({ Name: s("26.3") }),
      singleplayer_uuid: ints(
        -2026387133,
        -2012335350,
        -1968295491,
        1023601165,
      ),
      spawn: c({ dimension: s("minecraft:overworld"), pos: ints(0, 86, 0) }),
    });
    expect(readHostUuid(levelDat)).toBe("8737c943-880e-330a-8aae-31bd3d02ea0d");
    const worldGen = gzipSync(
      writeNbt(
        "",
        c({
          data: generator("minecraft:noise", {
            settings: s("minecraft:large_biomes"),
          }),
        }),
      ),
    );
    const player = gzipSync(
      writeNbt(
        "",
        c({ Dimension: s("minecraft:the_nether"), Pos: pos(681.5, 70, 375.2) }),
      ),
    );
    expect(readWorldMap(levelDat, { worldGen, player })).toEqual({
      seed: "-4172144997902289642",
      version: "26.3",
      worldType: "largeBiomes",
      spawn: { dimension: "overworld", x: 0, z: 0 },
      playerFound: true,
      player: { dimension: "nether", x: 681, z: 375 },
    });
    // Without the extra files: no seed and no player, but no error either.
    expect(readWorldMap(levelDat)).toMatchObject({ playerFound: false });
    expect(readWorldMap(levelDat).seed).toBeUndefined();
    expect(readHostUuid(level({}))).toBeUndefined();
  });

  it("reads the respawn point: 26.x's respawn compound and the older Spawn tags", () => {
    const withPlayer = (player: Record<string, Tag>) =>
      readWorldMap(level({ Player: c(player) })).respawn;
    expect(
      withPlayer({
        respawn: c({
          dimension: s("minecraft:overworld"),
          pos: ints(2268, 75, -665),
        }),
      }),
    ).toEqual({ dimension: "overworld", x: 2268, z: -665 });
    expect(
      withPlayer({
        SpawnX: i(-40),
        SpawnY: i(64),
        SpawnZ: i(12),
        SpawnDimension: s("minecraft:the_nether"),
      }),
    ).toEqual({ dimension: "nether", x: -40, z: 12 });
    // Before 1.16 there was no SpawnDimension: the overworld.
    expect(withPlayer({ SpawnX: i(1), SpawnY: i(2), SpawnZ: i(3) })).toEqual({
      dimension: "overworld",
      x: 1,
      z: 3,
    });
    expect(withPlayer({})).toBeUndefined();
    expect(
      withPlayer({
        respawn: c({ dimension: s("aether:aether"), pos: ints(0, 0, 0) }),
      }),
    ).toBeUndefined();
  });

  it("throws only for a level.dat that isn't NBT", () => {
    expect(() => readWorldMap(new Uint8Array([0, 1]))).toThrow();
  });
});
