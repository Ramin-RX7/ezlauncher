import { writeFile } from "node:fs/promises";
import { strToU8, zipSync, type Zippable } from "fflate";
import { sha1 } from "../../minecraft/testing/fakeFetch";

/** Test helper: one file a pack downloads, and the bytes the fake site serves for it. */
export interface FakePackFile {
  path: string;
  body: string;
  env?: { client?: string; server?: string };
  url?: string;
}

export const fileUrl = (path: string) =>
  `https://cdn.modrinth.com/data/test/${encodeURIComponent(path)}`;

export function packIndex({
  name = "Test Pack",
  versionId = "1.0.0",
  files = [],
  dependencies = { minecraft: "1.20.1", "fabric-loader": "0.16.0" },
  ...extra
}: {
  name?: string;
  versionId?: string;
  files?: FakePackFile[];
  dependencies?: Record<string, string>;
  [key: string]: unknown;
} = {}) {
  return {
    formatVersion: 1,
    game: "minecraft",
    versionId,
    name,
    files: files.map((f) => ({
      path: f.path,
      hashes: { sha1: sha1(f.body), sha512: "x" },
      ...(f.env && { env: f.env }),
      downloads: [f.url ?? fileUrl(f.path)],
      fileSize: f.body.length,
    })),
    dependencies,
    ...extra,
  };
}

/** Write a `.mrpack`: the index, plus `overrides/…` and `client-overrides/…` entries. */
export async function writeMrpack(
  dest: string,
  index: unknown,
  entries: Record<string, string> = {},
): Promise<void> {
  const zip: Zippable = {
    "modrinth.index.json": strToU8(JSON.stringify(index)),
  };
  for (const [name, body] of Object.entries(entries)) zip[name] = strToU8(body);
  await writeFile(dest, zipSync(zip));
}

/** Routes for `createFakeFetch` that serve the pack's downloads. */
export function packRoutes(files: readonly FakePackFile[]) {
  return Object.fromEntries(
    files.map((f) => [f.url ?? fileUrl(f.path), f.body]),
  );
}
