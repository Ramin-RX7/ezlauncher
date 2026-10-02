import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE_CATEGORIES, type StorageCategory } from "@shared/launcher";
import type { Paths } from "../minecraft/paths";

/*
 * How much of the data folder each part takes. Every file is counted once, even
 * when it's hard-linked into several places (mods, packs, shaders and data packs are
 * hard links from the stores into profiles and worlds). Links and junctions (a
 * profile's `saves/` entries) are never followed, so a world counts under worlds/.
 */

export { STORAGE_CATEGORIES };
export type { StorageCategory };

export interface CategoryUsage {
  bytes: number;
  files: number;
}

/** A walker that counts each file (by its identity) at most once. */
export function createSizeCounter() {
  const seen = new Set<string>();
  /** Bytes and files under `path` not counted before. */
  async function count(
    path: string,
    onFile?: () => void,
  ): Promise<CategoryUsage> {
    const total: CategoryUsage = { bytes: 0, files: 0 };
    const visit = async (p: string): Promise<void> => {
      let info;
      try {
        info = await lstat(p, { bigint: true });
      } catch {
        return; // gone meanwhile
      }
      if (info.isSymbolicLink()) return; // links and junctions: never followed
      if (info.isDirectory()) {
        let names: string[];
        try {
          names = await readdir(p);
        } catch {
          return;
        }
        // A few at a time: fast on big folders (assets), gentle on the disk.
        for (let i = 0; i < names.length; i += 32)
          await Promise.all(
            names.slice(i, i + 32).map((n) => visit(join(p, n))),
          );
        return;
      }
      if (!info.isFile()) return;
      const id = `${String(info.dev)}:${String(info.ino)}`;
      if (info.ino !== 0n && seen.has(id)) return;
      seen.add(id);
      total.bytes += Number(info.size);
      total.files++;
      onFile?.();
    };
    await visit(path);
    return total;
  }
  return { count };
}

/** The folders of each category, in the order they're counted (stores first). */
function categoryRoots(paths: Paths): [StorageCategory, string[]][] {
  const d = paths.dataDir;
  return [
    ["mods", [paths.modsStoreDir]],
    ["resourcePacks", [paths.resourcePacksStoreDir]],
    ["shaders", [paths.shaderPacksStoreDir]],
    ["dataPacks", [paths.dataPacksStoreDir]],
    ["versions", [paths.versionsDir]],
    ["libraries", [paths.librariesDir]],
    ["assets", [paths.assetsDir]],
    ["java", [paths.runtimesDir]],
    ["worlds", [paths.worldsDir]],
    ["backups", [paths.backupsDir, join(d, "modpack-backups")]],
    ["profiles", [paths.profilesDir]],
    ["launcher", [join(d, "launcher")]],
  ];
}

export interface DiskUsage {
  totalBytes: number;
  categories: Record<StorageCategory, CategoryUsage>;
}

/** The data folder's size by category. `onProgress` gets the files counted so far. */
export async function measureDisk(
  paths: Paths,
  { onProgress }: { onProgress?: (files: number) => void } = {},
): Promise<DiskUsage> {
  const counter = createSizeCounter();
  let files = 0;
  const tick = () => {
    files++;
    if (files % 500 === 0) onProgress?.(files);
  };
  const categories = Object.fromEntries(
    STORAGE_CATEGORIES.map((c) => [c, { bytes: 0, files: 0 }]),
  ) as Record<StorageCategory, CategoryUsage>;
  const known = new Set<string>();
  for (const [category, roots] of categoryRoots(paths)) {
    for (const root of roots) {
      known.add(root.toLowerCase());
      const u = await counter.count(root, tick);
      categories[category].bytes += u.bytes;
      categories[category].files += u.files;
    }
  }
  // Anything else in the data folder (legacy games/, dev-games/, …).
  let names: string[] = [];
  try {
    names = await readdir(paths.dataDir);
  } catch {
    // no data folder yet
  }
  for (const name of names) {
    const p = join(paths.dataDir, name);
    if (known.has(p.toLowerCase())) continue;
    const u = await counter.count(p, tick);
    categories.other.bytes += u.bytes;
    categories.other.files += u.files;
  }
  onProgress?.(files);
  const totalBytes = STORAGE_CATEGORIES.reduce(
    (n, c) => n + categories[c].bytes,
    0,
  );
  return { totalBytes, categories };
}
