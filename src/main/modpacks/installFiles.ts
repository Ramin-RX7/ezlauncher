import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Downloader } from "../minecraft/downloader";
import type { DownloadProgress } from "../minecraft/downloader";
import type { FileTask } from "../minecraft/fileTask";
import { safeJoin, type Paths } from "../minecraft/paths";
import { createHardLink } from "../profiles/links";
import { exists, tmpName } from "../profiles/linkedStore";
import type { PackFile } from "./mrpackIndex";

/*
 * Put a pack's downloaded files into a game folder. A file one of the libraries
 * already stores (same SHA1) is linked from there instead of downloaded again; the
 * libraries adopt the rest on the next sync. Every file lands under a temporary
 * name and is renamed into place, so an existing file (maybe a hard link into a
 * store) is replaced, never written into.
 */

/** Where a library would store this pack file, if it's one a library manages. */
export function storeFileFor(
  paths: Paths,
  path: string,
  sha1: string,
): string | undefined {
  const parts = path.split("/");
  if (parts.length !== 2) return undefined;
  const [dir, name = ""] = parts;
  if (dir === "mods" && /\.jar$/i.test(name)) return paths.modStoreFile(sha1);
  if (dir === "resourcepacks" && /\.zip$/i.test(name))
    return paths.resourcePackStoreFile(sha1);
  if (dir === "shaderpacks" && /\.zip$/i.test(name))
    return paths.shaderPackStoreFile(sha1);
  return undefined;
}

/** Files the libraries manage: never part of a pack's "other files". */
export const isLibraryPath = (paths: Paths, path: string) =>
  storeFileFor(paths, path, "0".repeat(40)) !== undefined;

export async function installPackFiles(
  { paths, downloader }: { paths: Paths; downloader: Pick<Downloader, "run"> },
  gameDir: string,
  files: readonly PackFile[],
  {
    signal,
    onProgress,
  }: {
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
  } = {},
): Promise<void> {
  const tasks: (FileTask & { dest: string })[] = [];
  const moves: { tmp: string; dest: string }[] = [];
  try {
    for (const f of files) {
      const dest = safeJoin(gameDir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      const tmp = tmpName(dest);
      const stored = storeFileFor(paths, f.path, f.sha1);
      if (stored && (await exists(stored))) {
        await createHardLink(stored, tmp);
      } else {
        tasks.push({ dest: tmp, url: f.url, sha1: f.sha1, size: f.size });
      }
      moves.push({ tmp, dest });
    }
    await downloader.run(tasks, {
      ...(signal && { signal }),
      ...(onProgress && { onProgress }),
    });
    for (const m of moves) await rename(m.tmp, m.dest);
  } finally {
    for (const m of moves) await rm(m.tmp, { force: true });
  }
}
