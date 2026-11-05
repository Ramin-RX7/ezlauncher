import type { MapPoint, VersionSummary } from "./launcher";

/*
 * Links to Chunkbase's Seed Map (https://www.chunkbase.com/apps/seed-map). The only
 * file that knows its link format, which Chunkbase doesn't document: the values below
 * are the ones its own page offers. If the site changes them, only this file changes.
 * The launcher only opens the link in the user's browser; it never fetches the site.
 */

export const CHUNKBASE_SEED_MAP = "https://www.chunkbase.com/apps/seed-map";

/**
 * Chunkbase's Java versions, newest first, each with the first Minecraft version it
 * covers (e.g. `java_1_21_9` is 1.21.9 – 1.21.11). Every one also has a Large Biomes
 * variant, `<platform>_lb`.
 */
export const CHUNKBASE_PLATFORMS: readonly {
  platform: string;
  from: string;
}[] = [
  { platform: "java_26_3", from: "26.3" },
  { platform: "java_26_2", from: "26.2" },
  { platform: "java_26_1", from: "26.1" },
  { platform: "java_1_21_9", from: "1.21.9" },
  { platform: "java_1_21_6", from: "1.21.6" },
  { platform: "java_1_21_5", from: "1.21.5" },
  { platform: "java_1_21_4", from: "1.21.4" },
  { platform: "java_1_21_2", from: "1.21.2" },
  { platform: "java_1_21", from: "1.21" },
  { platform: "java_1_20", from: "1.20" },
  { platform: "java_1_19_3", from: "1.19.3" },
  { platform: "java_1_19", from: "1.19" },
  { platform: "java_1_18", from: "1.18" },
  { platform: "java_1_17", from: "1.17" },
  { platform: "java_1_16", from: "1.16" },
  { platform: "java_1_15", from: "1.15" },
  { platform: "java_1_14", from: "1.14" },
  { platform: "java_1_13", from: "1.13" },
  { platform: "java_1_12", from: "1.12" },
  { platform: "java_1_11", from: "1.11" },
  { platform: "java_1_10", from: "1.10" },
  { platform: "java_1_9", from: "1.9" },
  { platform: "java_1_8", from: "1.8" },
  { platform: "java_1_7", from: "1.7.2" },
];

export interface ChunkbasePlatform {
  platform: string;
  /** The map may not match: a snapshot, or a version newer than Chunkbase's newest here. */
  approximate: boolean;
}

/**
 * Chunkbase's version for a Minecraft version. Version ids are opaque, so this orders
 * by `releaseTime` from the version list: the newest Chunkbase version that came out
 * at or before it (a snapshot gets the release before it). Undefined for versions the
 * list doesn't know or older than 1.7.
 */
export function chunkbasePlatform(
  version: string,
  largeBiomes: boolean,
  versions: readonly VersionSummary[],
): ChunkbasePlatform | undefined {
  const time = new Map(versions.map((v) => [v.id, Date.parse(v.releaseTime)]));
  const own = versions.find((v) => v.id === version && !v.loader);
  const released = time.get(version);
  if (!own || released === undefined || Number.isNaN(released))
    return undefined;
  const known = CHUNKBASE_PLATFORMS.filter((p) => time.has(p.from));
  const match = known.find((p) => (time.get(p.from) ?? Infinity) <= released);
  if (!match) return undefined;
  const newest = known[0];
  return {
    platform: largeBiomes ? `${match.platform}_lb` : match.platform,
    approximate:
      own.type !== "release" ||
      (match === newest &&
        version !== match.from &&
        !isPatchOf(version, match.from)),
  };
}

/** `26.3.1` is a patch of `26.3`: same world generation in practice. */
function isPatchOf(version: string, base: string): boolean {
  return version.startsWith(`${base}.`);
}

/** The Seed Map link for a seed, a Chunkbase version and (optionally) where to centre it. */
export function chunkbaseUrl(options: {
  seed: string;
  platform: string;
  point?: MapPoint;
}): string {
  const params: [string, string][] = [
    ["seed", options.seed],
    ["platform", options.platform],
  ];
  if (options.point) {
    params.push(
      ["dimension", options.point.dimension],
      ["x", String(Math.round(options.point.x))],
      ["z", String(Math.round(options.point.z))],
    );
  }
  const hash = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${CHUNKBASE_SEED_MAP}#${hash}`;
}
