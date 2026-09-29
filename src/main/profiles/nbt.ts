import { gunzipSync } from "fflate";

/*
 * Just enough NBT (Minecraft's binary format) to read a world's name and last
 * played time from `level.dat`: a gzipped root compound with a `Data` compound.
 * Every other tag is skipped. Bad input throws; callers fall back to the folder name.
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

/** Read `Data.LevelName` and `Data.LastPlayed` from the bytes of a (gzipped) `level.dat`. */
export function readLevelInfo(file: Uint8Array): LevelInfo {
  const isGzip = file[0] === 0x1f && file[1] === 0x8b;
  const r = new Reader(isGzip ? gunzipSync(file) : file);
  if (r.u8() !== COMPOUND) throw new Error("level.dat has no root compound");
  r.string(); // root name
  const info: LevelInfo = {};
  for (;;) {
    const type = r.u8();
    if (type === END) return info;
    const name = r.string();
    if (type !== COMPOUND || name !== "Data") {
      skipPayload(r, type, 1);
      continue;
    }
    for (;;) {
      const t = r.u8();
      if (t === END) return info;
      const key = r.string();
      if (t === STRING && key === "LevelName") info.name = r.string();
      else if (t === LONG && key === "LastPlayed")
        info.lastPlayed = Number(r.i64());
      else skipPayload(r, t, 2);
    }
  }
}
