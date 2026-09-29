import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  rename,
  rmdir,
  stat,
  symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { MoveProgress } from "@shared/launcher";
import { AppError } from "../core/errors";
import {
  createDirLink,
  linkTarget,
  removeLink,
  removeTree,
} from "../profiles/links";

/*
 * Move the whole data folder somewhere else. On the same drive it's one rename; on
 * another drive every file is copied (keeping hard links shared, so the mod library
 * stays one copy), then the old folder is deleted. Links that pointed inside the old
 * folder (worlds linked into profiles) are made again to point inside the new one.
 */

export type { MoveProgress };

/** Problems after the data was moved (it's safe in the new folder either way). */
export interface MoveResult {
  warnings: string[];
}

export interface MoveOptions {
  onProgress?: (p: MoveProgress) => void;
  signal?: AbortSignal;
  /** Copy even on the same drive (tests). */
  forceCopy?: boolean;
}

interface Entry {
  rel: string;
  kind: "dir" | "file" | "link";
  size: number;
  /** `dev:ino`: files with the same key are hard links to each other. */
  key: string;
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** The closest folder that exists: where `to` will be created. */
async function existingParent(path: string): Promise<string> {
  let dir = path;
  while (!(await exists(dir))) {
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dir;
}

async function walk(root: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const visit = async (rel: string) => {
    for (const name of await readdir(join(root, rel))) {
      const childRel = rel ? join(rel, name) : name;
      const info = await lstat(join(root, childRel), { bigint: true });
      if (info.isSymbolicLink()) {
        entries.push({ rel: childRel, kind: "link", size: 0, key: "" });
      } else if (info.isDirectory()) {
        entries.push({ rel: childRel, kind: "dir", size: 0, key: "" });
        await visit(childRel);
      } else if (info.isFile()) {
        entries.push({
          rel: childRel,
          kind: "file",
          size: Number(info.size),
          key: `${String(info.dev)}:${String(info.ino)}`,
        });
      }
    }
  };
  await visit("");
  return entries;
}

/** Make a link at `dest` like the one at `source`; targets inside `from` move to `to`. */
async function relinkOne(
  source: string,
  dest: string,
  from: string,
  to: string,
) {
  const target = await linkTarget(source);
  if (!target) return;
  const mapped = inside(target, from)
    ? join(to, relative(from, target))
    : target;
  if (source === dest) await removeLink(dest);
  let isDir = true;
  try {
    isDir = (await stat(mapped)).isDirectory();
  } catch {
    // a broken link: keep it a directory link, like world links
  }
  if (isDir) {
    await createDirLink(mapped, dest);
    return;
  }
  try {
    await symlink(mapped, dest, "file");
  } catch {
    await copyFile(mapped, dest); // file symlinks need rights on Windows: copy instead
  }
}

function checkCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new AppError("CANCELLED", "Moving was cancelled.");
}

export async function moveDataDir(
  fromInput: string,
  toInput: string,
  { onProgress, signal, forceCopy = false }: MoveOptions = {},
): Promise<MoveResult> {
  const from = resolve(fromInput);
  const to = resolve(toInput);
  if (!(await exists(from)) || !(await lstat(from)).isDirectory())
    throw new AppError("INVALID_PATH", "The current data folder is missing.");
  if (inside(to, from) || inside(from, to))
    throw new AppError(
      "INVALID_PATH",
      "Choose a folder that isn't inside the current one (or around it).",
    );
  const toExisted = await exists(to);
  if (toExisted) {
    if (!(await lstat(to)).isDirectory() || (await readdir(to)).length > 0)
      throw new AppError("DATA_DIR_NOT_EMPTY", "Choose an empty folder.");
  }

  const progress: MoveProgress = {
    step: "counting",
    files: 0,
    totalFiles: 0,
    bytes: 0,
    totalBytes: 0,
  };
  const report = (step: MoveProgress["step"]) => {
    progress.step = step;
    onProgress?.({ ...progress });
  };
  report("counting");

  // Same drive: one rename, then fix the links.
  const sameDrive =
    (await stat(from)).dev === (await stat(await existingParent(to))).dev;
  if (sameDrive && !forceCopy) {
    try {
      if (toExisted) await rmdir(to);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    } catch (err) {
      // Another drive after all, or something holds a file open: copy instead.
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!["EXDEV", "EPERM", "EBUSY", "EACCES"].includes(code)) throw err;
      await mkdir(to, { recursive: true });
      return copyAndClean();
    }
    // The data is in the new place now; a link that can't be fixed is only a warning.
    report("linking");
    const warnings: string[] = [];
    for (const e of await walk(to)) {
      if (e.kind !== "link") continue;
      await relinkOne(join(to, e.rel), join(to, e.rel), from, to).catch(
        (err: unknown) => {
          warnings.push(`${e.rel}: ${String(err)}`);
        },
      );
    }
    return { warnings };
  }

  return copyAndClean();

  async function copyAndClean(): Promise<MoveResult> {
    const entries = await walk(from);
    const files = entries.filter((e) => e.kind === "file");
    progress.totalFiles = files.length;
    progress.totalBytes = files.reduce((n, e) => n + e.size, 0);
    report("copying");

    try {
      await mkdir(to, { recursive: true });
      const copied = new Map<string, string>(); // dev:ino → its copy
      for (const e of entries) {
        checkCancelled(signal);
        const dest = join(to, e.rel);
        if (e.kind === "dir") await mkdir(dest, { recursive: true });
        if (e.kind !== "file") continue;
        const twin = copied.get(e.key);
        if (twin) {
          try {
            await link(twin, dest); // keep hard links shared
          } catch {
            await copyFile(twin, dest);
          }
        } else {
          await copyFile(join(from, e.rel), dest);
          copied.set(e.key, dest);
        }
        progress.files++;
        progress.bytes += e.size;
        onProgress?.({ ...progress });
      }
      report("linking");
      for (const e of entries) {
        checkCancelled(signal);
        if (e.kind === "link")
          await relinkOne(join(from, e.rel), join(to, e.rel), from, to);
      }
    } catch (err) {
      // Nothing half-moved: the copy goes, the old folder stays as it was.
      await removeTree(to).catch(() => undefined);
      if (toExisted)
        await mkdir(to, { recursive: true }).catch(() => undefined);
      throw err;
    }

    // Everything is copied: an old folder that can't be fully deleted is only a warning.
    report("cleaning");
    try {
      await removeTree(from);
      return { warnings: [] };
    } catch (err) {
      return { warnings: [`the old folder stays: ${String(err)}`] };
    }
  }
}
