import { gzipSync, strToU8 } from "fflate";

/** Test helper: a gzipped `level.dat` with `Data.LevelName`, `Data.LastPlayed` and some other tags. */
export function makeLevelDat(name: string, lastPlayed: number): Uint8Array {
  const parts: number[] = [];
  const u8 = (v: number) => parts.push(v & 0xff);
  const u16 = (v: number) => {
    u8(v >> 8);
    u8(v);
  };
  const i32 = (v: number) => {
    u16(v >>> 16);
    u16(v & 0xffff);
  };
  const i64 = (v: number) => {
    const big = BigInt(v);
    for (let s = 56n; s >= 0n; s -= 8n) u8(Number((big >> s) & 0xffn));
  };
  const str = (s: string) => {
    const bytes = strToU8(s);
    u16(bytes.length);
    for (const b of bytes) u8(b);
  };
  const tag = (type: number, tagName: string) => {
    u8(type);
    str(tagName);
  };

  tag(10, ""); // root
  tag(10, "Data");
  tag(3, "version");
  i32(19133);
  tag(9, "ServerBrands"); // a list, to exercise skipping
  u8(8);
  i32(2);
  str("vanilla");
  str("fabric");
  tag(10, "WorldGenSettings");
  tag(4, "seed");
  i64(123);
  tag(11, "ints");
  i32(2);
  i32(1);
  i32(2);
  u8(0); // end WorldGenSettings
  tag(8, "LevelName");
  str(name);
  tag(4, "LastPlayed");
  i64(lastPlayed);
  u8(0); // end Data
  u8(0); // end root
  return gzipSync(new Uint8Array(parts));
}
