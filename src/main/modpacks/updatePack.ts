import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeZip, type ZipSource } from "../core/zipWrite";
import type { Downloader, DownloadProgress } from "../minecraft/downloader";
import { safeJoin, type Paths } from "../minecraft/paths";
import { sha1File } from "../minecraft/verify";
import { installPackFiles } from "./installFiles";
import type { PackManifest } from "./manifest";
import type { PackFile } from "./mrpackIndex";
import { extractOverrides, type MrpackContents } from "./readMrpack";

/*
 * Updating a profile to another version of its pack. The manifest says what the
 * old version wrote; a file still as written is the pack's to replace or remove,
 * a file that differs was changed by the user and stays unless they say otherwise.
 * Files the pack never wrote (the user's own mods, worlds) are never touched.
 */

export type UpdateAction =
  /** New in this version. */
  | "add"
  /** Changed in this version; the file is still as the old version wrote it. */
  | "update"
  /** Changed in this version, but the user changed the file too: kept unless chosen. */
  | "changed"
  /** Gone from this version, and unchanged: removed. */
  | "remove"
  /** Gone from this version, but the user changed it: kept (now the user's). */
  | "keepRemoved";

export interface UpdateItem {
  path: string;
  action: UpdateAction;
}

export interface UpdatePlan {
  /** Only the paths that change or need a choice. */
  items: UpdateItem[];
  /** The new version's files (path → SHA1): the next manifest. */
  target: Record<string, string>;
  downloads: Map<string, PackFile>;
  /** Overrides, unpacked in the staging folder. */
  stagingDir: string;
  staged: Set<string>;
}

/** Worlds are never part of an update. */
const untouchable = (path: string) => /^saves(\/|$)/i.test(path);

async function diskSha1(path: string): Promise<string | undefined> {
  try {
    if (!(await lstat(path)).isFile()) return "";
  } catch {
    return undefined; // not there
  }
  return sha1File(path);
}

/**
 * Work out an update: unpack the new version's overrides into `stagingDir` (so their
 * hashes are known) and compare everything with the manifest and the disk.
 */
export async function planUpdate({
  file,
  contents,
  manifest,
  gameDir,
  stagingDir,
  signal,
}: {
  file: string;
  contents: MrpackContents;
  manifest: PackManifest;
  gameDir: string;
  stagingDir: string;
  signal?: AbortSignal;
}): Promise<UpdatePlan> {
  const skipped = new Set(manifest.skipped);
  const downloads = new Map<string, PackFile>();
  const target: Record<string, string> = {};
  for (const f of contents.index.files) {
    if ((f.optional && skipped.has(f.path)) || untouchable(f.path)) continue;
    downloads.set(f.path, f);
    target[f.path] = f.sha1;
  }
  const overrides = await extractOverrides(file, stagingDir, {
    accept: (path) => !untouchable(path),
    ...(signal && { signal }),
  });
  for (const [path, sha1] of overrides) {
    downloads.delete(path); // an override wins over a download
    target[path] = sha1;
  }

  const items: UpdateItem[] = [];
  for (const [path, sha1] of Object.entries(target)) {
    const disk = await diskSha1(safeJoin(gameDir, path));
    if (disk === sha1) continue;
    if (disk === undefined) items.push({ path, action: "add" });
    else if (manifest.files[path] === disk)
      items.push({ path, action: "update" });
    else items.push({ path, action: "changed" });
  }
  for (const [path, sha1] of Object.entries(manifest.files)) {
    if (path in target || untouchable(path)) continue;
    const disk = await diskSha1(safeJoin(gameDir, path));
    if (disk === undefined) continue;
    items.push({ path, action: disk === sha1 ? "remove" : "keepRemoved" });
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  return {
    items,
    target,
    downloads,
    stagingDir,
    staged: new Set(overrides.keys()),
  };
}

export interface ApplyResult {
  added: number;
  updated: number;
  removed: number;
  /** The zip of the files replaced or removed, when there were any. */
  backup?: string;
}

/**
 * Carry out a plan. `replace` are the "changed" paths the user chose to replace.
 * Replaced and removed files are zipped to `backupFile` first.
 */
export async function applyUpdate(
  deps: { paths: Paths; downloader: Pick<Downloader, "run"> },
  {
    plan,
    gameDir,
    replace,
    backupFile,
    signal,
    onProgress,
  }: {
    plan: UpdatePlan;
    gameDir: string;
    replace: ReadonlySet<string>;
    backupFile: string;
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
  },
): Promise<ApplyResult> {
  const write = plan.items.filter(
    (i) =>
      i.action === "add" ||
      i.action === "update" ||
      (i.action === "changed" && replace.has(i.path)),
  );
  const remove = plan.items.filter((i) => i.action === "remove");

  // What will be lost, zipped first.
  const old: ZipSource[] = [];
  for (const i of [...write, ...remove]) {
    if (i.action === "add") continue;
    const path = safeJoin(gameDir, i.path);
    try {
      const info = await lstat(path);
      if (info.isFile())
        old.push({ name: i.path, path, mtimeMs: info.mtimeMs });
    } catch {
      // gone meanwhile
    }
  }
  let backup: string | undefined;
  if (old.length > 0) {
    await writeZip(backupFile, old, { ...(signal && { signal }) });
    backup = backupFile;
  }

  const downloads = write
    .map((i) => plan.downloads.get(i.path))
    .filter((f): f is PackFile => f !== undefined);
  await installPackFiles(deps, gameDir, downloads, {
    ...(signal && { signal }),
    ...(onProgress && { onProgress }),
  });
  for (const i of write) {
    if (!plan.staged.has(i.path)) continue;
    const dest = safeJoin(gameDir, i.path);
    await mkdir(dirname(dest), { recursive: true });
    await rename(join(plan.stagingDir, ...i.path.split("/")), dest);
  }
  for (const i of remove) await rm(safeJoin(gameDir, i.path), { force: true });

  return {
    added: write.filter((i) => i.action === "add").length,
    updated: write.length - write.filter((i) => i.action === "add").length,
    removed: remove.length,
    ...(backup && { backup }),
  };
}
