import { strToU8 } from "fflate";

/** Test helper: an uncompressed `servers.dat` as the game writes it (plus an unknown tag). */
export function makeServersDat(
  servers: { name: string; ip: string; icon?: string; hidden?: boolean }[],
): Uint8Array {
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
  const str = (s: string) => {
    const bytes = strToU8(s);
    u16(bytes.length);
    for (const b of bytes) u8(b);
  };
  const tag = (type: number, name: string) => {
    u8(type);
    str(name);
  };
  tag(10, ""); // root
  tag(9, "servers");
  u8(10);
  i32(servers.length);
  for (const s of servers) {
    tag(1, "acceptTextures");
    u8(1);
    if (s.icon !== undefined) {
      tag(8, "icon");
      str(s.icon);
    }
    tag(8, "ip");
    str(s.ip);
    tag(8, "name");
    str(s.name);
    if (s.hidden !== undefined) {
      tag(1, "hidden");
      u8(s.hidden ? 1 : 0);
    }
    u8(0); // end server
  }
  u8(0); // end root
  return new Uint8Array(parts);
}
