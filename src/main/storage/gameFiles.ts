import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJson } from "../core/fsAtomic";
import { assetIndexId } from "../minecraft/assets";
import { isInstalled } from "../minecraft/installer";
import { collectLibraries } from "../minecraft/libraries";
import type { Paths } from "../minecraft/paths";
import type { Platform } from "../minecraft/platform";
import { assetIndexSchema } from "../minecraft/schemas";
import { diskVersionLoader, resolveVersion } from "../minecraft/versionJson";

/*
 * Game files (libraries, assets, half-finished version folders) that no installed
 * version needs. Worked out from every installed version's own JSON; if any of
 * them can't be read, nothing is called unneeded (it could be that version's).
 */

export interface NeededGameFiles {
  libraries: Set<string>;
  assetIndexes: Set<string>;
  assetObjects: Set<string>;
  virtualDirs: Set<string>;
  logConfigs: Set<string>;
}

/** File paths compare the same way the file system does (Windows ignores case). */
const key = (p: string) => {
  const r = resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

export async function neededGameFiles(
  paths: Paths,
  platform: Platform,
): Promise<NeededGameFiles | { unknown: string }> {
  const needed: NeededGameFiles = {
    libraries: new Set(),
    assetIndexes: new Set(),
    assetObjects: new Set(),
    virtualDirs: new Set(),
    logConfigs: new Set(),
  };
  const indexIds = new Set<string>();
  // Every folder with an install marker, even one whose JSON is now unreadable
  // (that version may still need its files once repaired).
  for (const dir of await subfolders(paths.versionsDir)) {
    const id = dir.slice(paths.versionsDir.length + 1);
    try {
      if (!(await isInstalled(paths, id))) continue;
    } catch {
      continue; // not a name the launcher made
    }
    let version;
    try {
      version = await resolveVersion(id, diskVersionLoader(paths));
    } catch {
      return { unknown: id };
    }
    const libs = collectLibraries(version, { platform }, paths);
    for (const t of libs.classpath) needed.libraries.add(key(t.dest));
    for (const n of libs.natives) needed.libraries.add(key(n.task.dest));
    indexIds.add(assetIndexId(version));
    const log = version.logging?.client?.file.id;
    if (log) needed.logConfigs.add(key(paths.logConfig(log)));
  }
  for (const id of indexIds) {
    const file = paths.assetIndex(id);
    needed.assetIndexes.add(key(file));
    needed.virtualDirs.add(key(paths.assetsVirtual(id)));
    const index = await readJson(file, assetIndexSchema).catch(() => undefined);
    if (!index) return { unknown: `assets ${id}` };
    for (const o of Object.values(index.objects))
      needed.assetObjects.add(key(paths.assetObject(o.hash)));
  }
  return needed;
}

export interface OrphanFile {
  path: string;
  bytes: number;
}

/** Every file under `dir` (links never followed). */
async function filesUnder(dir: string): Promise<OrphanFile[]> {
  const out: OrphanFile[] = [];
  const visit = async (p: string): Promise<void> => {
    let info;
    try {
      info = await lstat(p);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      let names: string[];
      try {
        names = await readdir(p);
      } catch {
        return;
      }
      for (let i = 0; i < names.length; i += 32)
        await Promise.all(names.slice(i, i + 32).map((n) => visit(join(p, n))));
    } else if (info.isFile()) {
      out.push({ path: p, bytes: info.size });
    }
  };
  await visit(dir);
  return out;
}

async function subfolders(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

export interface GameFileOrphans {
  /** Single files: libraries, asset indexes and objects, log configs. */
  files: OrphanFile[];
  /** Whole folders: half-finished versions, unused legacy asset copies. */
  folders: OrphanFile[];
}

/** What `needed` doesn't cover, under libraries/, assets/ and versions/. */
export async function orphanGameFiles(
  paths: Paths,
  needed: NeededGameFiles,
): Promise<GameFileOrphans> {
  const files: OrphanFile[] = [];
  const pick = async (dir: string, keep: Set<string>) => {
    for (const f of await filesUnder(dir))
      if (!keep.has(key(f.path))) files.push(f);
  };
  await pick(paths.librariesDir, needed.libraries);
  await pick(join(paths.assetsDir, "indexes"), needed.assetIndexes);
  await pick(join(paths.assetsDir, "objects"), needed.assetObjects);
  await pick(join(paths.assetsDir, "log_configs"), needed.logConfigs);

  const folders: OrphanFile[] = [];
  const sizeOf = async (dir: string) =>
    (await filesUnder(dir)).reduce((n, f) => n + f.bytes, 0);
  for (const dir of await subfolders(join(paths.assetsDir, "virtual")))
    if (!needed.virtualDirs.has(key(dir)))
      folders.push({ path: dir, bytes: await sizeOf(dir) });
  // A version folder without its marker is an install that never finished.
  for (const dir of await subfolders(paths.versionsDir)) {
    const id = dir.slice(paths.versionsDir.length + 1);
    let installed: boolean;
    try {
      installed = await isInstalled(paths, id);
    } catch {
      continue; // not a name the launcher made: leave it
    }
    if (!installed) folders.push({ path: dir, bytes: await sizeOf(dir) });
  }
  return { files, folders };
}
