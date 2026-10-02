import { AppError } from "../core/errors";
import { unzipEntries, type UnzippedFile } from "../core/unzip";
import { readZipEntries } from "../core/zipEntries";
import { safeJoin } from "../minecraft/paths";
import {
  checkPackPath,
  INDEX_NAME,
  parseIndex,
  type MrpackIndex,
} from "./mrpackIndex";

/*
 * A `.mrpack` file: the index, plus `overrides/` (copied into the game folder) and
 * `client-overrides/` (copied on top). `server-overrides/` is for servers only.
 */

const OVERRIDE_DIRS = ["overrides/", "client-overrides/"] as const;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
/** Unpacked overrides: generous (packs ship shader folders), but finite. */
export const MAX_OVERRIDE_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_OVERRIDE_FILES = 200_000;

export interface MrpackContents {
  index: MrpackIndex;
  /** Override files (after `client-overrides/` wins), relative to the game folder. */
  overrides: { path: string; size: number }[];
}

/** The path an override entry writes to, or undefined when it isn't one. */
function overridePath(name: string): string | undefined {
  for (const dir of OVERRIDE_DIRS) {
    if (name.startsWith(dir) && name.length > dir.length)
      return checkPackPath(name.slice(dir.length));
  }
  return undefined;
}

/** Read a pack's index and list its overrides, without unpacking anything. */
export async function readMrpack(file: string): Promise<MrpackContents> {
  const zip = await readZipEntries(
    file,
    (entries) => entries.filter((e) => e.name === INDEX_NAME),
    MAX_INDEX_BYTES,
  );
  if (!zip)
    throw new AppError(
      "MODPACK_INVALID",
      "This file can't be read as a mod pack.",
    );
  const data = zip.data.get(INDEX_NAME);
  if (!data)
    throw new AppError("MODPACK_INVALID", "This isn't a Modrinth mod pack.");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new AppError("MODPACK_INVALID", "The mod pack's index is damaged.");
  }
  const index = parseIndex(json);

  const overrides = new Map<string, { path: string; size: number }>();
  let total = 0;
  for (const e of zip.entries) {
    if (e.name.endsWith("/")) continue;
    const path = overridePath(e.name);
    if (path === undefined) continue;
    overrides.set(path.toLowerCase(), { path, size: e.size });
    total += e.size;
  }
  if (overrides.size > MAX_OVERRIDE_FILES || total > MAX_OVERRIDE_BYTES)
    throw new AppError("MODPACK_TOO_BIG", "The mod pack is too big to unpack.");
  return { index, overrides: [...overrides.values()] };
}

/**
 * Unpack the overrides into `gameDir`: `overrides/` first, then `client-overrides/`
 * over them. `accept` can leave paths out. Existing files are replaced.
 * Resolves to each written path (forward slashes) and its SHA1; the last write wins.
 */
export async function extractOverrides(
  file: string,
  gameDir: string,
  {
    accept = () => true,
    signal,
  }: { accept?: (path: string) => boolean; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  // One pass over the zip: an `overrides/` file that `client-overrides/` replaces is skipped.
  const listing = await readZipEntries(file, () => [], 0);
  if (!listing)
    throw new AppError(
      "MODPACK_INVALID",
      "This file can't be read as a mod pack.",
    );
  const clientOnly = new Set(
    listing.entries
      .filter((e) => e.name.startsWith("client-overrides/"))
      .map((e) => overridePath(e.name)?.toLowerCase()),
  );
  const pathOf = new Map<string, string>();
  const files: UnzippedFile[] = await unzipEntries(file, {
    code: "MODPACK_INVALID",
    overwrite: true,
    maxBytes: MAX_OVERRIDE_BYTES,
    maxFiles: MAX_OVERRIDE_FILES,
    ...(signal && { signal }),
    target: (name) => {
      const path = overridePath(name);
      if (path === undefined || !accept(path)) return undefined;
      if (name.startsWith("overrides/") && clientOnly.has(path.toLowerCase()))
        return undefined;
      pathOf.set(name, path);
      return safeJoin(gameDir, path);
    },
  });
  const written = new Map<string, string>();
  for (const f of files) {
    const path = pathOf.get(f.name);
    if (path !== undefined) written.set(path, f.sha1);
  }
  return written;
}
