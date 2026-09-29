import {
  constants,
  copyFile,
  link,
  lstat,
  readdir,
  readlink,
  rmdir,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/*
 * The only module that knows about link types:
 * - worlds: directory links (junctions on Windows, no admin rights needed; symlinks elsewhere);
 * - mods: hard links (a second name for the same file), or a copy where they don't work.
 */

/** Make `linkPath` a directory link to `target` (an absolute path is stored). */
export async function createDirLink(
  target: string,
  linkPath: string,
): Promise<void> {
  const type = process.platform === "win32" ? "junction" : "dir";
  await symlink(resolve(target), linkPath, type);
}

export async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Where a link points (absolute), or undefined if `path` isn't a link. */
export async function linkTarget(path: string): Promise<string | undefined> {
  try {
    return resolve(dirname(path), await readlink(path));
  } catch {
    return undefined;
  }
}

/** Remove a link itself. Never touches what it points to, and refuses anything that isn't a link. */
export async function removeLink(path: string): Promise<void> {
  if (!(await isLink(path))) throw new Error(`Not a link: ${path}`);
  try {
    await unlink(path);
  } catch (err) {
    // Some platforms remove directory links with rmdir; it fails on a real, non-empty folder.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    await rmdir(path);
  }
}

/**
 * Delete a folder tree without ever following a link: links are removed as links,
 * so a world linked into a profile survives deleting that profile.
 */
export async function removeTree(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return;
  }
  if (info.isSymbolicLink()) {
    await removeLink(path);
    return;
  }
  if (!info.isDirectory()) {
    await unlink(path);
    return;
  }
  for (const name of await readdir(path)) await removeTree(join(path, name));
  await rmdir(path);
}

/** Hard-link `src` to `dest`, or copy it where hard links don't work (e.g. FAT32, another drive). */
export async function createHardLink(
  src: string,
  dest: string,
): Promise<"linked" | "copied"> {
  try {
    await link(src, dest);
    return "linked";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw err;
    await copyFile(src, dest, constants.COPYFILE_EXCL);
    return "copied";
  }
}

/** Are these two names the same file on disk (e.g. hard links to one another)? */
export async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([
      stat(a, { bigint: true }),
      stat(b, { bigint: true }),
    ]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}
