import { strToU8, zipSync } from "fflate";

/** Test helper: the 8-byte PNG signature plus a bit, enough to count as an icon. */
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

/** A Fabric mod jar. Extra files make otherwise identical mods differ. */
export function fabricJar(
  json: Record<string, unknown>,
  extra: Record<string, Uint8Array> = {},
): Uint8Array {
  return zipSync({
    "fabric.mod.json": strToU8(JSON.stringify(json)),
    ...extra,
  });
}

export function fabricMod(id: string, version: string, minecraft = ">=1.18") {
  return fabricJar({
    schemaVersion: 1,
    id,
    version,
    name: `${id} mod`,
    depends: { minecraft },
  });
}
