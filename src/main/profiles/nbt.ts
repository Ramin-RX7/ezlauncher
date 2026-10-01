import { gunzipSync } from "fflate";

/*
 * Just enough NBT (Minecraft's binary format) to read a world's name, last played
 * time and data pack lists from `level.dat`: a gzipped root compound with a `Data`
 * compound. Every other tag is skipped. Read only: nothing here writes NBT. Bad
 * input throws; callers fall back to the folder name or "unknown".
 */

const END = 0;
const LONG = 4;
const STRING = 8;
const BYTE_ARRAY = 7;
const LIST = 9;
const COMPOUND = 10;
const INT_ARRAY = 11;
const LONG_ARRAY = 12;
const MAX_DEPTH = 64;

class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number): void {
    if (n < 0 || this.offset + n > this.bytes.length)
      throw new Error("truncated NBT");
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset);
    this.offset += 4;
    return v;
  }
  i64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return v;
  }
  string(): string {
    this.need(2);
    const length = this.view.getUint16(this.offset);
    this.offset += 2;
    this.need(length);
    // NBT uses Java's "modified UTF-8"; plain UTF-8 decoding is right for names.
    const text = new TextDecoder().decode(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return text;
  }
  skip(n: number): void {
    this.need(n);
    this.offset += n;
  }
}

const FIXED_SIZE: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 4,
  6: 8,
};

function skipPayload(r: Reader, type: number, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error("NBT too deep");
  const fixed = FIXED_SIZE[type];
  if (fixed !== undefined) {
    r.skip(fixed);
    return;
  }
  switch (type) {
    case BYTE_ARRAY:
      r.skip(r.i32());
      return;
    case STRING:
      r.string();
      return;
    case LIST: {
      const itemType = r.u8();
      const count = r.i32();
      if (count < 0) throw new Error("bad NBT list");
      for (let i = 0; i < count; i++) skipPayload(r, itemType, depth + 1);
      return;
    }
    case COMPOUND:
      for (;;) {
        const t = r.u8();
        if (t === END) return;
        r.string();
        skipPayload(r, t, depth + 1);
      }
    case INT_ARRAY:
      r.skip(r.i32() * 4);
      return;
    case LONG_ARRAY:
      r.skip(r.i32() * 8);
      return;
    default:
      throw new Error(`unknown NBT tag ${type}`);
  }
}

export interface LevelInfo {
  name?: string;
  /** Milliseconds since 1970. */
  lastPlayed?: number;
}

/** Calls `onTag` for each tag of `level.dat`'s `Data` compound; it reads or skips the payload. */
function readData(
  file: Uint8Array,
  onTag: (r: Reader, type: number, key: string) => void,
): void {
  const isGzip = file[0] === 0x1f && file[1] === 0x8b;
  const r = new Reader(isGzip ? gunzipSync(file) : file);
  if (r.u8() !== COMPOUND) throw new Error("level.dat has no root compound");
  r.string(); // root name
  for (;;) {
    const type = r.u8();
    if (type === END) return;
    const name = r.string();
    if (type !== COMPOUND || name !== "Data") {
      skipPayload(r, type, 1);
      continue;
    }
    for (;;) {
      const t = r.u8();
      if (t === END) return;
      onTag(r, t, r.string());
    }
  }
}

/** A list of strings (other lists are skipped and read as empty). */
function stringList(r: Reader, type: number, depth: number): string[] {
  if (type !== LIST) {
    skipPayload(r, type, depth);
    return [];
  }
  const itemType = r.u8();
  const count = r.i32();
  if (count < 0) throw new Error("bad NBT list");
  const items: string[] = [];
  for (let i = 0; i < count; i++) {
    if (itemType === STRING) items.push(r.string());
    else skipPayload(r, itemType, depth + 1);
  }
  return items;
}

/** Read `Data.LevelName` and `Data.LastPlayed` from the bytes of a (gzipped) `level.dat`. */
export function readLevelInfo(file: Uint8Array): LevelInfo {
  const info: LevelInfo = {};
  readData(file, (r, t, key) => {
    if (t === STRING && key === "LevelName") info.name = r.string();
    else if (t === LONG && key === "LastPlayed")
      info.lastPlayed = Number(r.i64());
    else skipPayload(r, t, 2);
  });
  return info;
}

export interface DataPackState {
  /** In load order, e.g. `vanilla`, `file/Terralith.zip`, `fabric`. */
  enabled: string[];
  /** Packs turned off in game (`/datapack disable` or the world's pack screen). */
  disabled: string[];
  /** The world's experimental features (`Data.enabled_features`), e.g. `minecraft:vanilla`. */
  features: string[];
}

/** The data pack lists of a world, from the bytes of its `level.dat`. */
export function readDataPackState(file: Uint8Array): DataPackState {
  const state: DataPackState = { enabled: [], disabled: [], features: [] };
  readData(file, (r, t, key) => {
    if (key === "enabled_features") {
      state.features = stringList(r, t, 2);
    } else if (key === "DataPacks" && t === COMPOUND) {
      for (;;) {
        const inner = r.u8();
        if (inner === END) return;
        const name = r.string();
        if (name === "Enabled") state.enabled = stringList(r, inner, 3);
        else if (name === "Disabled") state.disabled = stringList(r, inner, 3);
        else skipPayload(r, inner, 3);
      }
    } else skipPayload(r, t, 2);
  });
  return state;
}
