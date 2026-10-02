import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeZip, type ZipSource } from "../core/zipWrite";
import type { Paths } from "../minecraft/paths";
import { isLibraryPath } from "./installFiles";
import { ALLOWED_HOSTS, INDEX_NAME } from "./mrpackIndex";

/*
 * A profile as a Modrinth mod pack. Library files a site knows (mods, resource
 * packs, shaders) become downloads in the index; everything else chosen goes into
 * `overrides/`. Worlds are never exported.
 */

/** Top-level entries never offered: worlds, the launcher's backups, the game's lock. */
const HIDDEN = /^(saves|.*\.ezl-bak|.*\.part)$/i;
/** Offered but left out unless chosen: logs, caches, and personal files. */
export const DEFAULT_OFF = new Set(
  [
    "logs",
    "crash-reports",
    "screenshots",
    "debug",
    "downloads",
    ".fabric",
    ".quilt",
    ".cache",
    ".mixin.out",
    "servers.dat",
    "servers.dat_old",
    "usercache.json",
    "usernamecache.json",
    "command_history.txt",
    "realms_persistence.json",
  ].map((s) => s.toLowerCase()),
);

export interface ExportEntry {
  name: string;
  folder: boolean;
  /** Ticked at first. */
  suggested: boolean;
}

/** What a profile's folder offers to export (top-level files and folders). */
export async function exportEntries(gameDir: string): Promise<ExportEntry[]> {
  let names: string[];
  try {
    names = await readdir(gameDir);
  } catch {
    return [];
  }
  const out: ExportEntry[] = [];
  for (const name of names) {
    if (HIDDEN.test(name)) continue;
    const info = await lstat(join(gameDir, name)).catch(() => undefined);
    if (!info || info.isSymbolicLink()) continue;
    if (!info.isFile() && !info.isDirectory()) continue;
    out.push({
      name,
      folder: info.isDirectory(),
      suggested: !DEFAULT_OFF.has(name.toLowerCase()),
    });
  }
  return out.sort((a, b) =>
    a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1,
  );
}

interface FoundFile {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/** Every real file under the chosen entries (links are skipped). */
async function walk(gameDir: string, include: readonly string[]) {
  const files: FoundFile[] = [];
  const visit = async (rel: string) => {
    const abs = join(gameDir, ...rel.split("/"));
    const info = await lstat(abs).catch(() => undefined);
    if (!info || info.isSymbolicLink()) return;
    if (info.isFile()) {
      if (!/\.(ezl-bak|part)$/i.test(rel))
        files.push({ rel, abs, size: info.size, mtimeMs: info.mtimeMs });
      return;
    }
    if (!info.isDirectory()) return;
    for (const name of await readdir(abs)) await visit(`${rel}/${name}`);
  };
  for (const name of include) {
    if (HIDDEN.test(name) || name.includes("/") || name.includes("\\"))
      continue;
    await visit(name);
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function hashes(path: string) {
  const sha1 = createHash("sha1");
  const sha512 = createHash("sha512");
  for await (const chunk of createReadStream(path)) {
    sha1.update(chunk as Buffer);
    sha512.update(chunk as Buffer);
  }
  return { sha1: sha1.digest("hex"), sha512: sha512.digest("hex") };
}

export interface ExportOptions {
  gameDir: string;
  /** Top-level names to include. */
  include: readonly string[];
  name: string;
  versionNumber: string;
  summary?: string;
  /** `minecraft` plus the loader's key (`fabric-loader`, `quilt-loader`) → version. */
  dependencies: Record<string, string>;
  /** Download links for files a site knows, by SHA1. */
  identify: (sha1s: string[]) => Promise<Map<string, string>>;
  dest: string;
  signal?: AbortSignal;
  onProgress?: (bytes: number, totalBytes: number) => void;
}

export interface ExportResult {
  /** Files linked to their site. */
  downloads: number;
  /** Files put inside the pack. */
  included: number;
  /** Library files no site knows (inside the pack, so the pack is bigger). */
  unknown: string[];
}

export async function exportModpack(
  paths: Paths,
  opts: ExportOptions,
): Promise<ExportResult> {
  const files = await walk(opts.gameDir, opts.include);
  const library = files.filter((f) => isLibraryPath(paths, f.rel));
  const hashed = new Map<string, { sha1: string; sha512: string }>();
  for (const f of library) hashed.set(f.rel, await hashes(f.abs));
  const links = await opts.identify([...hashed.values()].map((h) => h.sha1));

  const indexFiles = [];
  const overrides: FoundFile[] = [];
  const unknown: string[] = [];
  for (const f of files) {
    const h = hashed.get(f.rel);
    const url = h && links.get(h.sha1);
    let host = "";
    try {
      host = url ? new URL(url).hostname : "";
    } catch {
      // not a URL
    }
    if (h && url && ALLOWED_HOSTS.has(host)) {
      indexFiles.push({
        path: f.rel,
        hashes: { sha1: h.sha1, sha512: h.sha512 },
        downloads: [url],
        fileSize: f.size,
      });
    } else {
      if (h) unknown.push(f.rel);
      overrides.push(f);
    }
  }

  const index = {
    formatVersion: 1,
    game: "minecraft",
    versionId: opts.versionNumber,
    name: opts.name,
    ...(opts.summary && { summary: opts.summary }),
    files: indexFiles,
    dependencies: opts.dependencies,
  };
  const totalBytes = overrides.reduce((n, f) => n + f.size, 0);
  const entries: ZipSource[] = [
    {
      name: INDEX_NAME,
      data: new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`),
    },
    ...overrides.map((f) => ({
      name: `overrides/${f.rel}`,
      path: f.abs,
      mtimeMs: f.mtimeMs,
    })),
  ];
  await writeZip(opts.dest, entries, {
    ...(opts.signal && { signal: opts.signal }),
    onProgress: (bytes) => opts.onProgress?.(bytes, totalBytes),
  });
  return {
    downloads: indexFiles.length,
    included: overrides.length,
    unknown,
  };
}
