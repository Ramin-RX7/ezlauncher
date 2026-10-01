import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8 } from "fflate";
import { readZipEntries } from "../../core/zipEntries";
import { compareFormats, type PackFormat } from "./packFormat";

/*
 * A pack's `pack.mcmeta` (and `pack.png`), from a zip or a folder. The game reads
 * `pack.mcmeta` leniently (comments, trailing commas), so this does too. Its
 * compatibility comes in three styles:
 *   "pack_format": 15                                  (one format)
 *   "supported_formats": 15 | [15, 22] | {min_inclusive, max_inclusive}   (1.20.2+)
 *   "min_format": 69 | [69, 0], "max_format": 75 | [75, 1]                (1.21.9+)
 */

/** Formats a pack supports, inclusive. */
export interface PackRange {
  min: PackFormat;
  max: PackFormat;
}

export interface PackMeta {
  /** Plain text: text components flattened, § colour codes removed. */
  description: string;
  range?: PackRange;
  /** Experimental features a data pack needs (`features.enabled`, e.g. `minecraft:bundle`). */
  features?: string[];
}

export type PackRead =
  | { status: "ok"; meta: PackMeta; icon?: Uint8Array }
  /** `pack.mcmeta` sits one folder down: the game won't load it. */
  | { status: "nested"; folder: string }
  /** No `pack.mcmeta`: not a pack. */
  | { status: "invalid" }
  /** Couldn't be read (damaged zip, unreadable `pack.mcmeta`). */
  | { status: "unreadable" };

export type PackCompat = "compatible" | "tooOld" | "tooNew" | "unknown";

const MAX_MCMETA = 256 * 1024;
const MAX_ICON = 2 * 1024 * 1024;
const ANY_MINOR = Number.MAX_SAFE_INTEGER;

/** JSON with comments and trailing commas, as Gson's lenient mode reads it. */
function parseLenient(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Flatten a text component (string, object with text/extra, or array) to plain text. */
function plainText(component: unknown, depth = 0): string {
  if (depth > 16) return "";
  if (typeof component === "string") return component;
  if (typeof component === "number" || typeof component === "boolean")
    return String(component);
  if (Array.isArray(component))
    return component.map((c) => plainText(c, depth + 1)).join("");
  if (typeof component === "object" && component !== null) {
    const c = component as Record<string, unknown>;
    const own =
      typeof c.text === "string"
        ? c.text
        : typeof c.translate === "string"
          ? typeof c.fallback === "string"
            ? c.fallback
            : c.translate
          : "";
    return own + (c.extra === undefined ? "" : plainText(c.extra, depth + 1));
  }
  return "";
}

const cleanText = (text: string) =>
  text
    .replace(/§./g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

/** `69` or `[69, 0]`; a bare number as a maximum allows every minor version. */
function format(v: unknown, isMax: boolean): PackFormat | undefined {
  const n = int(v);
  if (n !== undefined) return { major: n, minor: isMax ? ANY_MINOR : 0 };
  if (Array.isArray(v)) {
    const major = int(v[0]);
    if (major === undefined) return undefined;
    const minor = int(v[1]);
    return { major, minor: minor ?? (isMax ? ANY_MINOR : 0) };
  }
  return undefined;
}

const majors = (min: number, max: number): PackRange => ({
  min: { major: min, minor: 0 },
  max: { major: max, minor: ANY_MINOR },
});

function rangeOf(pack: Record<string, unknown>): PackRange | undefined {
  const min = format(pack.min_format, false);
  const max = format(pack.max_format, true);
  if (min && max) return { min, max };
  const supported = pack.supported_formats;
  const one = int(supported);
  if (one !== undefined) return majors(one, one);
  if (Array.isArray(supported)) {
    const [a, b] = [int(supported[0]), int(supported[1])];
    if (a !== undefined && b !== undefined) return majors(a, b);
  }
  if (typeof supported === "object" && supported !== null) {
    const s = supported as Record<string, unknown>;
    const [a, b] = [int(s.min_inclusive), int(s.max_inclusive)];
    if (a !== undefined && b !== undefined) return majors(a, b);
  }
  const single = int(pack.pack_format);
  return single === undefined ? undefined : majors(single, single);
}

/** Read `pack.mcmeta`; undefined when it isn't one at all. */
export function parsePackMcmeta(bytes: Uint8Array): PackMeta | undefined {
  const text = strFromU8(bytes).replace(/^\uFEFF/, "");
  let json: unknown;
  try {
    json = parseLenient(text);
  } catch {
    // Broken JSON the game might still read: take what can be found.
    const format = /"pack_format"\s*:\s*(\d+)/.exec(text)?.[1];
    if (format === undefined) return undefined;
    const raw = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
    let description = raw ?? "";
    try {
      if (raw !== undefined) description = JSON.parse(`"${raw}"`) as string;
    } catch {
      // keep the text as written
    }
    return {
      description: cleanText(description),
      range: majors(Number(format), Number(format)),
    };
  }
  if (typeof json !== "object" || json === null) return undefined;
  const pack = (json as Record<string, unknown>).pack;
  if (typeof pack !== "object" || pack === null) return undefined;
  const p = pack as Record<string, unknown>;
  const range = rangeOf(p);
  const features = featuresOf((json as Record<string, unknown>).features);
  return {
    description: cleanText(plainText(p.description)),
    ...(range && { range }),
    ...(features.length > 0 && { features }),
  };
}

/** `"features": { "enabled": ["minecraft:bundle"] }` (top level, beside `pack`). */
function featuresOf(features: unknown): string[] {
  if (typeof features !== "object" || features === null) return [];
  const enabled = (features as Record<string, unknown>).enabled;
  return Array.isArray(enabled)
    ? enabled.filter((f): f is string => typeof f === "string")
    : [];
}

/** Can a game with this format use a pack with this range? */
export function packCompat(
  range: PackRange | undefined,
  game: PackFormat | undefined,
): PackCompat {
  if (!range || !game) return "unknown";
  if (compareFormats(game, range.min) < 0) return "tooNew";
  if (compareFormats(game, range.max) > 0) return "tooOld";
  return "compatible";
}

const isPng = (b: Uint8Array | undefined): b is Uint8Array =>
  b !== undefined &&
  b.length > 8 &&
  b[0] === 0x89 &&
  b[1] === 0x50 &&
  b[2] === 0x4e &&
  b[3] === 0x47;

function result(mcmeta: Uint8Array, icon: Uint8Array | undefined): PackRead {
  const meta = parsePackMcmeta(mcmeta);
  if (!meta) return { status: "unreadable" };
  return { status: "ok", meta, ...(isPng(icon) && { icon }) };
}

/** A zip pack: only its index, `pack.mcmeta` and `pack.png` are read. */
export async function readPackZip(path: string): Promise<PackRead> {
  const read = await readZipEntries(
    path,
    (entries) =>
      entries.filter((e) => e.name === "pack.mcmeta" || e.name === "pack.png"),
    MAX_ICON,
  );
  if (!read) return { status: "unreadable" };
  if (!read.entries.some((e) => e.name === "pack.mcmeta")) {
    const nested = read.entries.find((e) =>
      /^[^/]+\/pack\.mcmeta$/.test(e.name),
    );
    return nested
      ? {
          status: "nested",
          folder: nested.name.slice(0, nested.name.indexOf("/")),
        }
      : { status: "invalid" };
  }
  const mcmeta = read.data.get("pack.mcmeta");
  if (!mcmeta || mcmeta.length > MAX_MCMETA) return { status: "unreadable" };
  return result(mcmeta, read.data.get("pack.png"));
}

/**
 * A zip data pack: a pack with a `data/` folder. A zip with only `assets/` is a
 * resource pack, not a data pack; one with both is both.
 */
export async function readDataPackZip(path: string): Promise<PackRead> {
  const read = await readPackZip(path);
  if (read.status !== "ok" && read.status !== "nested") return read;
  const index = await readZipEntries(path, () => [], 0);
  if (!index) return { status: "unreadable" };
  if (read.status === "nested")
    return index.entries.some((e) => e.name.startsWith(`${read.folder}/data/`))
      ? read
      : { status: "invalid" };
  return index.entries.some((e) => e.name.startsWith("data/"))
    ? read
    : { status: "invalid" };
}

async function readSmall(
  path: string,
  max: number,
): Promise<Uint8Array | undefined> {
  try {
    if ((await stat(path)).size > max) return undefined;
    return new Uint8Array(await readFile(path));
  } catch {
    return undefined;
  }
}

/** An unzipped pack folder. */
export async function readPackFolder(dir: string): Promise<PackRead> {
  const mcmeta = await readSmall(join(dir, "pack.mcmeta"), MAX_MCMETA);
  if (mcmeta)
    return result(mcmeta, await readSmall(join(dir, "pack.png"), MAX_ICON));
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        (await readSmall(join(dir, entry.name, "pack.mcmeta"), MAX_MCMETA))
      )
        return { status: "nested", folder: entry.name };
    }
  } catch {
    return { status: "unreadable" };
  }
  return { status: "invalid" };
}

/** An unzipped data pack folder (a pack folder with `data/` inside). */
export async function readDataPackFolder(dir: string): Promise<PackRead> {
  const read = await readPackFolder(dir);
  if (read.status !== "ok") return read;
  try {
    return (await stat(join(dir, "data"))).isDirectory()
      ? read
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}
