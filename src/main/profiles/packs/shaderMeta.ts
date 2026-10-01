import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readZipEntries } from "../../core/zipEntries";
import type { PackRead } from "./packMeta";

/*
 * Whether a zip or folder is a shader pack, the way Iris decides it. Shader packs
 * have no metadata file (no name, version or icon): a pack is anything with a
 * `shaders/` folder. In a zip Iris takes the first `shaders/` at any depth, so a
 * pack zipped inside one wrapper folder still works; in a folder it loads
 * `<folder>/shaders` only, so a folder one level too deep doesn't.
 */

const isDir = async (path: string) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/** A zip shader pack: only its index is read. */
export async function readShaderZip(path: string): Promise<PackRead> {
  const read = await readZipEntries(path, () => [], 0);
  if (!read) return { status: "unreadable" };
  return read.entries.some((e) => /(^|\/)shaders\//.test(e.name))
    ? { status: "ok", meta: { description: "" } }
    : { status: "invalid" };
}

/** An unzipped shader pack folder. */
export async function readShaderFolder(dir: string): Promise<PackRead> {
  if (await isDir(join(dir, "shaders")))
    return { status: "ok", meta: { description: "" } };
  try {
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (
        entry.isDirectory() &&
        (await isDir(join(dir, entry.name, "shaders")))
      )
        return { status: "nested", folder: entry.name };
  } catch {
    return { status: "unreadable" };
  }
  return { status: "invalid" };
}
