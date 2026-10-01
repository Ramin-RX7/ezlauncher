import { strFromU8 } from "fflate";
import { readZipEntries } from "../../core/zipEntries";

/*
 * Which resource and data pack formats a Minecraft version uses. Since 1.14 the
 * client jar says so itself (`version.json`), so new versions need no table here;
 * only the frozen 1.6–1.13.2 releases are listed. `version.json` comes in three shapes:
 *   1.14–1.16    "pack_version": 4          (data packs used the same number then)
 *   1.17–1.21.8  "pack_version": { "resource": 15, "data": 15 }
 *   1.21.9+      "pack_version": { "resource_major": 69, "resource_minor": 0,
 *                                  "data_major": 88, "data_minor": 0 }
 */

/** A pack format; formats before 1.21.9 have minor 0. */
export interface PackFormat {
  major: number;
  minor: number;
}

export interface GameFormat {
  resource: PackFormat;
  /** The data pack format; none before 1.13. */
  data?: PackFormat;
  /** The data version (`options.txt`'s `version:`), when known. */
  worldVersion?: number;
}

export function compareFormats(a: PackFormat, b: PackFormat): number {
  return a.major - b.major || a.minor - b.minor;
}

const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

/** The resource format and data version from a client jar's `version.json`. */
export function formatFromVersionJson(json: unknown): GameFormat | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const { pack_version: pack, world_version: world } = json as Record<
    string,
    unknown
  >;
  let resource: PackFormat | undefined;
  let data: PackFormat | undefined;
  const plain = int(pack);
  if (plain !== undefined) {
    resource = { major: plain, minor: 0 };
    data = resource;
  } else if (typeof pack === "object" && pack !== null) {
    const p = pack as Record<string, unknown>;
    const major = int(p.resource_major) ?? int(p.resource);
    if (major !== undefined)
      resource = { major, minor: int(p.resource_minor) ?? 0 };
    const dataMajor = int(p.data_major) ?? int(p.data);
    if (dataMajor !== undefined)
      data = { major: dataMajor, minor: int(p.data_minor) ?? 0 };
  }
  if (!resource) return undefined;
  const worldVersion = int(world);
  return {
    resource,
    ...(data && { data }),
    ...(worldVersion !== undefined && { worldVersion }),
  };
}

/** Releases before 1.13 have no data packs. */
export function predatesDataPacks(versionId: string): boolean {
  const m = RELEASE.exec(versionId);
  return m !== null && Number(m[1]) < 13;
}

/** `1.<minor>[.<patch>]` releases. */
const RELEASE = /^1\.(\d+)(?:\.(\d+))?$/;

/** Releases before 1.6 used texture packs, which this launcher doesn't manage. */
export function predatesResourcePacks(versionId: string): boolean {
  const m = RELEASE.exec(versionId);
  return m !== null && Number(m[1]) < 6;
}

/** [first 1.x, last 1.x, resource format] for the releases before `version.json`. */
const LEGACY_FORMATS = [
  [6, 8, 1],
  [9, 10, 2],
  [11, 12, 3],
  [13, 13, 4],
] as const;

/** 1.6–1.13.2 releases: their jars have no `version.json`. */
export function legacyFormat(versionId: string): GameFormat | undefined {
  const m = RELEASE.exec(versionId);
  if (!m) return undefined;
  const minor = Number(m[1]);
  const major = LEGACY_FORMATS.find(
    ([from, to]) => minor >= from && minor <= to,
  )?.[2];
  if (major === undefined) return undefined;
  const worldVersion = LEGACY_WORLD_VERSIONS[versionId];
  return {
    resource: { major, minor: 0 },
    // Data packs came in 1.13, with data format 4.
    ...(minor >= 13 && { data: { major: 4, minor: 0 } }),
    ...(worldVersion !== undefined && { worldVersion }),
  };
}

/** 1.13 data versions: written with `file/` entries, so a new options.txt needs them. */
const LEGACY_WORLD_VERSIONS: Record<string, number> = {
  "1.13": 1519,
  "1.13.1": 1628,
  "1.13.2": 1631,
};

/**
 * The format of an installed version: from its client jar, else the legacy table.
 * `gameVersion` is the Minecraft version (for a loader install, the one it's built on).
 */
export async function readGameFormat(
  clientJar: string,
  gameVersion: string,
): Promise<GameFormat | undefined> {
  const read = await readZipEntries(
    clientJar,
    (entries) => entries.filter((e) => e.name === "version.json"),
    64 * 1024,
  );
  const bytes = read?.data.get("version.json");
  if (bytes) {
    try {
      const fromJar = formatFromVersionJson(JSON.parse(strFromU8(bytes)));
      if (fromJar) return fromJar;
    } catch {
      // fall back to the table
    }
  }
  return legacyFormat(gameVersion);
}

/**
 * How `options.txt` names user packs: `file/<name>` since 1.13, the bare file name
 * before. Packs are listed lowest priority first in both.
 */
export type OptionsDialect = "modern" | "legacy";

export function optionsDialect(format: PackFormat): OptionsDialect {
  return format.major >= 4 ? "modern" : "legacy";
}
