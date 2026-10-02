import { gunzipSync } from "fflate";

/*
 * Lossless NBT: read a whole file into a tree and write it back byte for byte the
 * same (when unchanged). Used where the launcher edits a game file (the server
 * list); `nbt.ts` stays the quick read-only reader for `level.dat`. Strings are
 * Java's "modified UTF-8" both ways. Files are written uncompressed.
 */

export const TAG = {
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12,
} as const;

export type Tag =
  | { type: 1 | 2 | 3 | 5 | 6; value: number }
  | { type: 4; value: bigint }
  | { type: 7; value: Uint8Array }
  | { type: 8; value: string }
  | { type: 9; itemType: number; value: Tag[] }
  | { type: 10; value: [string, Tag][] }
  | { type: 11; value: Int32Array }
  | { type: 12; value: BigInt64Array };

export type Compound = Extract<Tag, { type: 10 }>;

const MAX_DEPTH = 512;

/** Java's modified UTF-8 (`DataInput.readUTF`): NUL is two bytes, astral characters are surrogate pairs. */
export function decodeMutf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++] ?? 0;
    if (a < 0x80) {
      out += String.fromCharCode(a);
    } else if ((a & 0xe0) === 0xc0) {
      const b = bytes[i++] ?? 0;
      out += String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
    } else if ((a & 0xf0) === 0xe0) {
      const b = bytes[i++] ?? 0;
      const c = bytes[i++] ?? 0;
      out += String.fromCharCode(
        ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f),
      );
    } else {
      throw new Error("bad modified UTF-8");
    }
  }
  return out;
}

export function encodeMutf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i); // UTF-16 units: astral characters stay surrogate pairs
    if (c !== 0 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  if (out.length > 0xffff) throw new Error("NBT string too long");
  return new Uint8Array(out);
}

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
  get done(): boolean {
    return this.offset >= this.bytes.length;
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.offset);
    this.offset += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.offset);
    this.offset += 4;
    return v;
  }
  i64() {
    this.need(8);
    const v = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.offset);
    this.offset += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.offset);
    this.offset += 8;
    return v;
  }
  bytesOf(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  string(): string {
    this.need(2);
    const length = this.view.getUint16(this.offset);
    this.offset += 2;
    return decodeMutf8(this.bytesOf(length));
  }
}

function count(r: Reader): number {
  const n = r.i32();
  if (n < 0) throw new Error("bad NBT length");
  return n;
}

function readPayload(r: Reader, type: number, depth: number): Tag {
  if (depth > MAX_DEPTH) throw new Error("NBT too deep");
  switch (type) {
    case TAG.BYTE:
      return { type, value: r.i8() };
    case TAG.SHORT:
      return { type, value: r.i16() };
    case TAG.INT:
      return { type, value: r.i32() };
    case TAG.LONG:
      return { type, value: r.i64() };
    case TAG.FLOAT:
      return { type, value: r.f32() };
    case TAG.DOUBLE:
      return { type, value: r.f64() };
    case TAG.BYTE_ARRAY:
      return { type, value: r.bytesOf(count(r)) };
    case TAG.STRING:
      return { type, value: r.string() };
    case TAG.LIST: {
      const itemType = r.u8();
      const n = count(r);
      const value: Tag[] = [];
      for (let i = 0; i < n; i++)
        value.push(readPayload(r, itemType, depth + 1));
      return { type, itemType, value };
    }
    case TAG.COMPOUND: {
      const value: [string, Tag][] = [];
      for (;;) {
        const t = r.u8();
        if (t === TAG.END) return { type, value };
        value.push([r.string(), readPayload(r, t, depth + 1)]);
      }
    }
    case TAG.INT_ARRAY: {
      const n = count(r);
      const value = new Int32Array(n);
      for (let i = 0; i < n; i++) value[i] = r.i32();
      return { type, value };
    }
    case TAG.LONG_ARRAY: {
      const n = count(r);
      const value = new BigInt64Array(n);
      for (let i = 0; i < n; i++) value[i] = r.i64();
      return { type, value };
    }
    default:
      throw new Error(`unknown NBT tag ${type}`);
  }
}

/** Read a file's root compound (gzipped or not). Throws on anything malformed. */
export function readNbt(file: Uint8Array): { name: string; root: Compound } {
  const isGzip = file[0] === 0x1f && file[1] === 0x8b;
  const r = new Reader(isGzip ? gunzipSync(file) : file);
  if (r.u8() !== TAG.COMPOUND) throw new Error("NBT root isn't a compound");
  const name = r.string();
  const root = readPayload(r, TAG.COMPOUND, 0);
  if (root.type !== TAG.COMPOUND) throw new Error("NBT root isn't a compound");
  return { name, root };
}

class Writer {
  private chunks: Uint8Array[] = [];
  private bytes(b: Uint8Array) {
    this.chunks.push(b);
  }
  private fixed(n: number, set: (v: DataView) => void) {
    const b = new Uint8Array(n);
    set(new DataView(b.buffer));
    this.bytes(b);
  }
  u8(v: number) {
    this.fixed(1, (d) => {
      d.setUint8(0, v);
    });
  }
  i8(v: number) {
    this.fixed(1, (d) => {
      d.setInt8(0, v);
    });
  }
  i16(v: number) {
    this.fixed(2, (d) => {
      d.setInt16(0, v);
    });
  }
  i32(v: number) {
    this.fixed(4, (d) => {
      d.setInt32(0, v);
    });
  }
  i64(v: bigint) {
    this.fixed(8, (d) => {
      d.setBigInt64(0, v);
    });
  }
  f32(v: number) {
    this.fixed(4, (d) => {
      d.setFloat32(0, v);
    });
  }
  f64(v: number) {
    this.fixed(8, (d) => {
      d.setFloat64(0, v);
    });
  }
  raw(b: Uint8Array) {
    this.bytes(b);
  }
  string(s: string) {
    const b = encodeMutf8(s);
    this.fixed(2, (d) => {
      d.setUint16(0, b.length);
    });
    this.bytes(b);
  }
  result(): Uint8Array {
    const size = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

function writePayload(w: Writer, tag: Tag): void {
  switch (tag.type) {
    case TAG.BYTE:
      w.i8(tag.value);
      return;
    case TAG.SHORT:
      w.i16(tag.value);
      return;
    case TAG.INT:
      w.i32(tag.value);
      return;
    case TAG.LONG:
      w.i64(tag.value);
      return;
    case TAG.FLOAT:
      w.f32(tag.value);
      return;
    case TAG.DOUBLE:
      w.f64(tag.value);
      return;
    case TAG.BYTE_ARRAY:
      w.i32(tag.value.length);
      w.raw(tag.value);
      return;
    case TAG.STRING:
      w.string(tag.value);
      return;
    case TAG.LIST:
      // An empty list keeps its item type (the game writes END for one it made empty).
      w.u8(tag.value.length === 0 ? tag.itemType : (tag.value[0]?.type ?? 0));
      w.i32(tag.value.length);
      for (const item of tag.value) {
        if (item.type !== (tag.value[0]?.type ?? 0))
          throw new Error("an NBT list mixes tag types");
        writePayload(w, item);
      }
      return;
    case TAG.COMPOUND:
      for (const [name, value] of tag.value) {
        w.u8(value.type);
        w.string(name);
        writePayload(w, value);
      }
      w.u8(TAG.END);
      return;
    case TAG.INT_ARRAY:
      w.i32(tag.value.length);
      for (const v of tag.value) w.i32(v);
      return;
    case TAG.LONG_ARRAY:
      w.i32(tag.value.length);
      for (const v of tag.value) w.i64(v);
      return;
  }
}

/** Write a root compound, uncompressed (as the game writes `servers.dat`). */
export function writeNbt(name: string, root: Compound): Uint8Array {
  const w = new Writer();
  w.u8(TAG.COMPOUND);
  w.string(name);
  writePayload(w, root);
  return w.result();
}

/** A compound's tag by name. */
export function get(c: Compound, name: string): Tag | undefined {
  return c.value.find(([n]) => n === name)?.[1];
}

/** Set (or add, at the end) a compound's tag. */
export function set(c: Compound, name: string, tag: Tag): void {
  const at = c.value.findIndex(([n]) => n === name);
  if (at >= 0) c.value[at] = [name, tag];
  else c.value.push([name, tag]);
}

export function remove(c: Compound, name: string): void {
  c.value = c.value.filter(([n]) => n !== name);
}
