import type { OptionsDialect } from "./packs/packFormat";

/*
 * The resource pack lines of a profile's `options.txt` (one `key:value` per line).
 * Only `resourcePacks` and `incompatibleResourcePacks` are ever changed; every other
 * line, the order of lines and the line endings stay exactly as the game wrote them.
 *
 * What Minecraft does with these lists (checked with 26.3, see Scope 08):
 * - Packs are listed lowest priority first: the last entry wins.
 * - Entries for missing files and unknown names are dropped when the game starts.
 * - An incompatible pack is dropped unless it's also in `incompatibleResourcePacks`.
 * - A compatible pack listed there is NOT loaded that session (the game unlists it
 *   and loads it next time), so only packs known to be incompatible go there.
 * - Built-in packs (`programmer_art`, `fabric`, …) keep their place.
 * - The game rewrites the whole file on start, with CRLF line endings on Windows.
 */

const PACKS = "resourcePacks";
const INCOMPATIBLE = "incompatibleResourcePacks";

export interface PackLists {
  /** Lowest priority first. */
  packs: string[];
  incompatible: string[];
}

const keyOf = (line: string) => {
  const colon = line.indexOf(":");
  return colon < 0 ? "" : line.slice(0, colon);
};

function readList(lines: readonly string[], key: string): string[] {
  const line = lines.find((l) => keyOf(l) === key);
  if (line === undefined) return [];
  try {
    const value: unknown = JSON.parse(line.slice(key.length + 1));
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return []; // damaged (e.g. a cut-off file): the game would ignore it too
  }
}

const splitLines = (text: string) => text.split(/\r?\n/);
const lineEnding = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

export function readPackLists(text: string): PackLists {
  const lines = splitLines(text);
  return {
    packs: readList(lines, PACKS),
    incompatible: readList(lines, INCOMPATIBLE),
  };
}

/** Replace (or add) the two pack lines, leaving everything else untouched. */
export function writePackLists(text: string, lists: PackLists): string {
  const eol = lineEnding(text);
  const lines = splitLines(text);
  const values: Record<string, string[]> = {
    [PACKS]: lists.packs,
    [INCOMPATIBLE]: lists.incompatible,
  };
  const done = new Set<string>();
  const out = lines.map((line) => {
    const key = keyOf(line);
    const value = values[key];
    if (!value || done.has(key)) return line;
    done.add(key);
    return `${key}:${JSON.stringify(value)}`;
  });
  const missing = Object.entries(values)
    .filter(([key]) => !done.has(key))
    .map(([key, value]) => `${key}:${JSON.stringify(value)}`);
  if (missing.length > 0) {
    // Before the final newline, if there is one.
    const at =
      out.length > 0 && out[out.length - 1] === ""
        ? out.length - 1
        : out.length;
    out.splice(at, 0, ...missing);
  }
  return out.join(eol);
}

/**
 * A new `options.txt` with only the pack lines (and the data version, when known):
 * the game fills in every other setting with its defaults on start.
 */
export function newOptionsText(
  lists: PackLists,
  worldVersion: number | undefined,
  eol: string,
): string {
  return [
    ...(worldVersion === undefined ? [] : [`version:${worldVersion}`]),
    `${PACKS}:${JSON.stringify(lists.packs)}`,
    `${INCOMPATIBLE}:${JSON.stringify(lists.incompatible)}`,
    "",
  ].join(eol);
}

/** How a pack file or folder in `resourcepacks/` is named in the lists. */
export function packEntry(name: string, dialect: OptionsDialect): string {
  return dialect === "modern" ? `file/${name}` : name;
}

/** The file or folder name of a user pack entry; undefined for built-in packs. */
export function entryName(
  entry: string,
  dialect: OptionsDialect,
): string | undefined {
  if (dialect === "legacy") return entry;
  return entry.startsWith("file/") ? entry.slice("file/".length) : undefined;
}

/**
 * Put the launcher's active packs (`active`, lowest priority first) into a pack list.
 * Entries the launcher doesn't manage (built-in packs, unknown names) keep their
 * places; the managed ones fill the places managed entries had, in the new order,
 * and any more go at the end (the highest priority).
 */
export function mergePacks(
  current: readonly string[],
  active: readonly string[],
  isManaged: (entry: string) => boolean,
): string[] {
  let next = 0;
  const out: string[] = [];
  for (const entry of current) {
    if (!isManaged(entry)) out.push(entry);
    else if (next < active.length) out.push(active[next++] ?? entry);
  }
  return [...out, ...active.slice(next)];
}

/**
 * The incompatible list: unmanaged entries stay, managed ones are exactly `needed`
 * (active packs known to be incompatible; never ones whose compatibility is unknown).
 */
export function mergeIncompatible(
  current: readonly string[],
  needed: readonly string[],
  isManaged: (entry: string) => boolean,
): string[] {
  const kept = current.filter((e) => !isManaged(e));
  return [...kept, ...needed.filter((e) => !kept.includes(e))];
}
