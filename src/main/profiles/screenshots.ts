import { lstat, mkdir, readdir, rename, rmdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Logger } from "../core/logger";
import type { Paths } from "../minecraft/paths";
import { createDirLink, linkTarget, removeLink } from "./links";

/*
 * Every profile's screenshots go to one folder, `<data>/screenshots/`: each
 * profile's `screenshots` is a directory link to it (as worlds are linked into
 * `saves/`). Deleting a profile removes only its link, so screenshots are kept.
 */

export interface ScreenshotSyncOptions {
  profileIds: string[];
  only?: string[];
  isRunning: (profileId: string) => boolean;
}

/** Windows paths ignore case. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  return norm(a) === norm(b);
}

/** `name`, or `name (2)`, `name (3)`… — the first that isn't in `dir` yet. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try {
      await lstat(join(dir, candidate));
    } catch {
      return candidate;
    }
  }
}

/** Move everything in `from` into `to` (clashing names get a number), then remove `from`. */
async function moveInto(from: string, to: string): Promise<number> {
  let moved = 0;
  for (const name of await readdir(from)) {
    await rename(join(from, name), join(to, await freeName(to, name)));
    moved++;
  }
  await rmdir(from);
  return moved;
}

/**
 * Point every idle profile's `screenshots` at the shared folder: a real folder
 * (screenshots taken before, or where linking once failed) is emptied into it
 * first; a missing or wrong link is made again. Where a link can't be made (a drive
 * without them) the profile keeps a real folder.
 */
export async function syncScreenshots(
  { paths, logger }: { paths: Paths; logger?: Logger },
  { profileIds, only, isRunning }: ScreenshotSyncOptions,
): Promise<void> {
  const shared = paths.screenshotsDir;
  await mkdir(shared, { recursive: true });
  const targets = (only ?? profileIds).filter(
    (id) => profileIds.includes(id) && !isRunning(id),
  );
  for (const profileId of targets) {
    const link = paths.screenshotsLink(profileId);
    try {
      const target = await linkTarget(link);
      if (target !== undefined) {
        if (samePath(target, shared)) continue;
        await removeLink(link);
      } else {
        let info;
        try {
          info = await lstat(link);
        } catch {
          info = undefined;
        }
        if (info?.isDirectory()) {
          const moved = await moveInto(link, shared);
          if (moved > 0)
            logger?.info(
              `moved ${moved} screenshots of ${profileId} to the shared folder`,
            );
        } else if (info) {
          // A file where the folder should be: leave it alone.
          logger?.warn(`${link} isn't a folder; screenshots not linked`);
          continue;
        }
      }
      await mkdir(paths.gameDir(profileId), { recursive: true });
      try {
        await createDirLink(shared, link);
      } catch (err) {
        // No links here: the game makes a real folder again, kept per profile.
        logger?.warn(`can't link screenshots of ${profileId}`, err);
      }
    } catch (err) {
      logger?.warn(`screenshot sync of ${profileId} failed`, err);
    }
  }
}
