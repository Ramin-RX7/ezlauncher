import type { MapDimension, MapPoint, WorldMapInfo } from "@shared/launcher";
import { get, readNbt, TAG, type Compound, type Tag } from "./nbtTree";

/*
 * What a seed map needs from a world: its seed, version, world type, spawn, and the
 * player's last position, respawn point and death, from the bytes of `level.dat` and the files newer
 * versions moved out of it (see `readWorldMap`). Read only. Missing or odd tags drop
 * that field instead of throwing; only a `level.dat` that isn't NBT at all throws.
 */

/** A compound's tag by name; undefined for a missing compound. */
const at = (c: Compound | undefined, name: string): Tag | undefined =>
  c ? get(c, name) : undefined;

const compound = (tag: Tag | undefined): Compound | undefined =>
  tag?.type === TAG.COMPOUND ? tag : undefined;

const str = (tag: Tag | undefined): string | undefined =>
  tag?.type === TAG.STRING ? tag.value : undefined;

/** A number tag (byte … double, or a long) as a finite number. */
function num(tag: Tag | undefined): number | undefined {
  if (!tag) return undefined;
  if (tag.type === TAG.LONG) return Number(tag.value);
  if (
    tag.type === TAG.BYTE ||
    tag.type === TAG.SHORT ||
    tag.type === TAG.INT ||
    tag.type === TAG.FLOAT ||
    tag.type === TAG.DOUBLE
  )
    return Number.isFinite(tag.value) ? tag.value : undefined;
  return undefined;
}

/** `[x, y, z]` from an int array or a list of numbers (`Pos` is a list of doubles). */
function triple(tag: Tag | undefined): [number, number, number] | undefined {
  let values: number[] | undefined;
  if (tag?.type === TAG.INT_ARRAY) values = Array.from(tag.value);
  else if (tag?.type === TAG.LIST)
    values = tag.value.map((t) => num(t) ?? Number.NaN);
  const [x, y, z] = values ?? [];
  if (
    values?.length !== 3 ||
    x === undefined ||
    y === undefined ||
    z === undefined
  )
    return undefined;
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return [x, y, z];
}

/** `minecraft:the_nether` (1.16+) or the old ids -1 / 0 / 1. Modded dimensions: undefined. */
export function mapDimension(tag: Tag | undefined): MapDimension | undefined {
  const name = str(tag);
  if (name !== undefined) {
    const id = name.startsWith("minecraft:") ? name.slice(10) : name;
    if (id === "overworld") return "overworld";
    if (id === "the_nether") return "nether";
    if (id === "the_end") return "end";
    return undefined;
  }
  const n = num(tag);
  if (n === 0) return "overworld";
  if (n === -1) return "nether";
  if (n === 1) return "end";
  return undefined;
}

function point(
  dimension: MapDimension | undefined,
  pos: [number, number, number] | undefined,
): MapPoint | undefined {
  if (!dimension || !pos) return undefined;
  return { dimension, x: Math.floor(pos[0]), z: Math.floor(pos[2]) };
}

function readSeed(
  data: Compound,
  settings: Compound | undefined,
): string | undefined {
  // 1.16+: the world generation settings' seed; before: RandomSeed.
  const seed = at(settings, "seed") ?? get(data, "RandomSeed");
  return seed?.type === TAG.LONG ? seed.value.toString() : undefined;
}

function readWorldType(
  data: Compound,
  settings: Compound | undefined,
): WorldMapInfo["worldType"] {
  if (settings) {
    // 1.16+: the overworld's generator.
    const generator = compound(
      at(
        compound(
          at(compound(at(settings, "dimensions")), "minecraft:overworld"),
        ),
        "generator",
      ),
    );
    if (!generator) return "normal";
    const type = str(get(generator, "type"));
    if (type === "minecraft:flat") return "flat";
    if (type !== "minecraft:noise") return "custom";
    // 1.16–1.17 kept the Large Biomes flag on the biome source.
    if (num(at(compound(get(generator, "biome_source")), "large_biomes")) === 1)
      return "largeBiomes";
    const preset = str(get(generator, "settings"));
    if (preset === undefined || preset === "minecraft:overworld")
      return "normal";
    if (preset === "minecraft:large_biomes") return "largeBiomes";
    if (preset === "minecraft:amplified") return "amplified";
    return "custom";
  }
  // Before 1.16: `generatorName`.
  const name = str(get(data, "generatorName"))?.toLowerCase();
  if (name === undefined || name === "default" || name === "default_1_1")
    return "normal";
  if (name === "largebiomes") return "largeBiomes";
  if (name === "amplified") return "amplified";
  if (name === "flat") return "flat";
  return "custom";
}

function readSpawn(data: Compound): MapPoint | undefined {
  // Newer versions keep the spawn as a compound with a position and dimension.
  const spawn = compound(get(data, "spawn"));
  if (spawn) {
    const dimension = get(spawn, "dimension");
    return point(
      dimension ? mapDimension(dimension) : "overworld",
      triple(get(spawn, "pos")),
    );
  }
  const x = num(get(data, "SpawnX"));
  const z = num(get(data, "SpawnZ"));
  if (x === undefined || z === undefined) return undefined;
  return { dimension: "overworld", x: Math.floor(x), z: Math.floor(z) };
}

/** Where the player respawns: a bed or respawn anchor they set. */
function readRespawn(player: Compound): MapPoint | undefined {
  // 26.x: a `respawn` compound with `pos` and `dimension`.
  const respawn = compound(get(player, "respawn"));
  if (respawn) {
    const dimension = get(respawn, "dimension");
    return point(
      dimension ? mapDimension(dimension) : "overworld",
      triple(get(respawn, "pos")),
    );
  }
  // Before: SpawnX/Y/Z, with SpawnDimension since 1.16 (older ones: the overworld).
  const x = num(get(player, "SpawnX"));
  const z = num(get(player, "SpawnZ"));
  if (x === undefined || z === undefined) return undefined;
  const dimensionTag = get(player, "SpawnDimension");
  const dimension = dimensionTag ? mapDimension(dimensionTag) : "overworld";
  return dimension && { dimension, x: Math.floor(x), z: Math.floor(z) };
}

function readPlayer(
  player: Compound,
): Pick<WorldMapInfo, "player" | "respawn" | "lastDeath"> {
  // An old player without `Dimension` is in the overworld.
  const dimensionTag = get(player, "Dimension");
  const here = point(
    dimensionTag ? mapDimension(dimensionTag) : "overworld",
    triple(get(player, "Pos")),
  );
  const respawn = readRespawn(player);
  const death = compound(get(player, "LastDeathLocation"));
  const died = point(
    mapDimension(at(death, "dimension")),
    triple(at(death, "pos")),
  );
  return {
    ...(here && { player: here }),
    ...(respawn && { respawn }),
    ...(died && { lastDeath: died }),
  };
}

/** A file's root compound, or undefined when it's damaged. */
function rootOf(file: Uint8Array | undefined): Compound | undefined {
  if (!file) return undefined;
  try {
    return readNbt(file).root;
  } catch {
    return undefined;
  }
}

/**
 * The single-player host's UUID (26.x: `Data.singleplayer_uuid`, four ints), dashed
 * like the file names in `players/data/`. Undefined when `level.dat` has none.
 */
export function readHostUuid(levelDat: Uint8Array): string | undefined {
  const data = compound(get(readNbt(levelDat).root, "Data"));
  const tag = at(data, "singleplayer_uuid");
  if (tag?.type !== TAG.INT_ARRAY || tag.value.length !== 4) return undefined;
  const hex = Array.from(tag.value, (n) =>
    (n >>> 0).toString(16).padStart(8, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The map info of a world, from its `level.dat` and, where newer versions moved them
 * out of it, two more files:
 * - `worldGen`: `data/minecraft/world_gen_settings.dat` (26.x), read when `level.dat`
 *   has no `WorldGenSettings`;
 * - `player`: the player's own file (`players/data/<uuid>.dat` in 26.x, else
 *   `playerdata/<uuid>.dat`), read when `level.dat` has no host `Data.Player`.
 * Throws only when `level.dat` isn't NBT.
 */
export function readWorldMap(
  levelDat: Uint8Array,
  files: { worldGen?: Uint8Array; player?: Uint8Array } = {},
): WorldMapInfo {
  const data = compound(get(readNbt(levelDat).root, "Data"));
  if (!data) return { worldType: "normal", playerFound: false };
  const settings =
    compound(get(data, "WorldGenSettings")) ??
    compound(at(rootOf(files.worldGen), "data"));
  const seed = readSeed(data, settings);
  const version = str(at(compound(get(data, "Version")), "Name"));
  const player = compound(get(data, "Player")) ?? rootOf(files.player);
  const spawn = readSpawn(data);
  return {
    ...(seed !== undefined && { seed }),
    ...(version && { version }),
    worldType: readWorldType(data, settings),
    ...(spawn && { spawn }),
    playerFound: player !== undefined,
    ...(player && readPlayer(player)),
  };
}
