import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { OrphanWorld, WorldInfo } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import type { Paths } from "../minecraft/paths";
import {
  createDirLink,
  isLink,
  linkTarget,
  removeLink,
  removeTree,
} from "./links";
import { readLevelInfo } from "./nbt";

/*
 * Every world lives in `worlds/<worldId>/`. A flag file inside it names the profile
 * that owns it (the source of truth), and that profile's `saves/<worldId>` is a link to it.
 * Minecraft ignores the flag and sees the links as normal folders.
 */

export const WORLD_FLAG = "ezlauncher-world.json";
const flagSchema = z.object({ schema: z.literal(1), profileId: z.string() });

export interface WorldDeps {
  paths: Paths;
  logger?: Logger;
}

export interface SyncOptions {
  /** Every profile id that exists (worlds flagged with any other id are orphans). */
  profileIds: readonly string[];
  /** Only sync these profiles (default: all). */
  only?: readonly string[];
  /** Profiles with a running game are never touched: Minecraft locks their worlds. */
  isRunning: (profileId: string) => boolean;
}

export interface SyncResult {
  orphans: OrphanWorld[];
  /** Worlds that stay real folders in a profile's `saves/` because a link couldn't be made. */
  unlinked: { profileId: string; worldId: string }[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isRealDir(path: string): Promise<boolean> {
  try {
    const s = await lstat(path);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}

/** A world has been deleted in game when its folder has no level data left at all. */
async function hasLevel(dir: string): Promise<boolean> {
  for (const name of ["level.dat", "level.dat_old", "level.dat_new"]) {
    if (await exists(join(dir, name))) return true;
  }
  return false;
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export async function readWorldOwner(
  paths: Paths,
  worldId: string,
): Promise<string | undefined> {
  try {
    return (
      await readJson(join(paths.worldDir(worldId), WORLD_FLAG), flagSchema)
    )?.profileId;
  } catch {
    return undefined;
  }
}

async function writeOwner(dir: string, profileId: string): Promise<void> {
  await writeJsonAtomic(join(dir, WORLD_FLAG), { schema: 1, profileId });
}

/** A folder name for `worlds/`: the game's own name, made safe, with `-2`, `-3`… if taken. */
export async function uniqueWorldId(
  paths: Paths,
  wanted: string,
): Promise<string> {
  let base = wanted
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 100);
  if (!base || /^\.+$/.test(base)) base = "world";
  let id = base;
  for (let n = 2; await exists(paths.worldDir(id)); n++) id = `${base}-${n}`;
  return id;
}

/** Name and last played time from `level.dat`, falling back to the folder name. */
async function describe(
  dir: string,
  id: string,
): Promise<{ name: string; lastPlayed?: string }> {
  try {
    const bytes = await readFile(join(dir, "level.dat"));
    if (bytes.length > 16 * 1024 * 1024) throw new Error("level.dat too big");
    const info = readLevelInfo(bytes);
    return {
      name: info.name?.trim() || id,
      ...(info.lastPlayed && {
        lastPlayed: new Date(info.lastPlayed).toISOString(),
      }),
    };
  } catch {
    return { name: id };
  }
}

/** Windows paths ignore case. */
function samePath(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const norm = (p: string) =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  return norm(a) === norm(b);
}

/**
 * Bring `worlds/` and every profile's `saves/` in line:
 * 1. adopt worlds created in game (real folders in `saves/`),
 * 2. remove worlds deleted in game (folders with no level data left),
 * 3. make each profile's `saves/` link exactly the worlds flagged with its id,
 * 4. report orphans (flagged with a profile that no longer exists).
 */
export async function syncWorlds(
  { paths, logger }: WorldDeps,
  { profileIds, only, isRunning }: SyncOptions,
): Promise<SyncResult> {
  const known = new Set(profileIds);
  const targets = (only ?? profileIds).filter(
    (id) => known.has(id) && !isRunning(id),
  );
  const unlinked: SyncResult["unlinked"] = [];
  await mkdir(paths.worldsDir, { recursive: true });
  // One stuck world (a folder another program holds open, an odd name) must not
  // stop the others, or block launching: log it and carry on.
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      logger?.warn(`world sync: ${what} failed`, err);
    }
  };

  // 1. Adopt real world folders into worlds/.
  for (const profileId of targets) {
    const saves = paths.savesDir(profileId);
    for (const name of await listDir(saves)) {
      const entry = join(saves, name);
      if (
        !(await isRealDir(entry)) ||
        !(await exists(join(entry, "level.dat")))
      )
        continue;
      await attempt(`adopting ${name}`, async () => {
        const worldId = await uniqueWorldId(paths, name);
        const home = paths.worldDir(worldId);
        await writeOwner(entry, profileId);
        await rename(entry, home);
        try {
          await createDirLink(home, paths.saveLink(profileId, worldId));
          logger?.info(`adopted world ${worldId} into ${profileId}`);
        } catch (err) {
          // No links here (e.g. a network drive): the world stays where the game made it.
          await rename(home, entry);
          unlinked.push({ profileId, worldId: name });
          logger?.warn(`can't link world ${name}; leaving it in place`, err);
        }
      });
    }
  }

  // 2. Owners, and worlds deleted in game.
  const owners = new Map<string, string | undefined>();
  for (const worldId of await listDir(paths.worldsDir)) {
    await attempt(`checking ${worldId}`, async () => {
      const dir = paths.worldDir(worldId);
      if (!(await isRealDir(dir))) return;
      const owner = await readWorldOwner(paths, worldId);
      if (owner && !(await hasLevel(dir))) {
        if (!isRunning(owner)) {
          await unlinkEverywhere(paths, worldId);
          await removeTree(dir);
          logger?.info(`world ${worldId} was deleted in game; removed`);
        }
        return;
      }
      owners.set(worldId, owner);
    });
  }

  // 3. Links from flags.
  for (const profileId of targets) {
    const saves = paths.savesDir(profileId);
    await mkdir(saves, { recursive: true });
    const wanted = new Set(
      [...owners].filter(([, o]) => o === profileId).map(([id]) => id),
    );
    for (const name of await listDir(saves)) {
      const entry = join(saves, name);
      if (!(await isLink(entry))) continue;
      await attempt(`checking the link ${name}`, async () => {
        const ok =
          wanted.has(name) &&
          samePath(await linkTarget(entry), paths.worldDir(name));
        if (ok) wanted.delete(name);
        else await removeLink(entry);
      });
    }
    for (const worldId of wanted) {
      await attempt(`linking ${worldId}`, async () => {
        const linkPath = paths.saveLink(profileId, worldId);
        if (await exists(linkPath)) {
          logger?.warn(
            `saves/${worldId} in ${profileId} is in the way; skipped`,
          );
          return;
        }
        try {
          await createDirLink(paths.worldDir(worldId), linkPath);
        } catch (err) {
          // Can't link: move the world itself into the profile.
          await rename(paths.worldDir(worldId), linkPath);
          unlinked.push({ profileId, worldId });
          logger?.warn(
            `can't link world ${worldId}; moved it into the profile`,
            err,
          );
        }
      });
    }
  }

  // 4. Orphans.
  return { orphans: await listOrphans(paths, profileIds), unlinked };
}

/** Worlds in `worlds/` whose owner profile doesn't exist (or that have no flag). Read only. */
export async function listOrphans(
  paths: Paths,
  profileIds: readonly string[],
): Promise<OrphanWorld[]> {
  const known = new Set(profileIds);
  const orphans: OrphanWorld[] = [];
  for (const worldId of await listDir(paths.worldsDir)) {
    const dir = paths.worldDir(worldId);
    if (!(await isRealDir(dir)) || !(await hasLevel(dir))) continue;
    const owner = await readWorldOwner(paths, worldId);
    if (owner && known.has(owner)) continue;
    orphans.push({ id: worldId, ...(await describe(dir, worldId)) });
  }
  return orphans;
}

/** Remove every profile's link to a world (before deleting it). */
async function unlinkEverywhere(paths: Paths, worldId: string): Promise<void> {
  for (const profileId of await listDir(paths.profilesDir)) {
    let linkPath;
    try {
      linkPath = paths.saveLink(profileId, worldId);
    } catch {
      continue;
    }
    if (await isLink(linkPath)) await removeLink(linkPath);
  }
}

/** A profile's worlds: the linked ones it owns, plus real folders that couldn't be linked. */
export async function listWorlds(
  paths: Paths,
  profileId: string,
): Promise<WorldInfo[]> {
  const result: WorldInfo[] = [];
  for (const worldId of await listDir(paths.worldsDir)) {
    const dir = paths.worldDir(worldId);
    if (!(await isRealDir(dir))) continue;
    if ((await readWorldOwner(paths, worldId)) !== profileId) continue;
    result.push({
      id: worldId,
      linked: true,
      ...(await describe(dir, worldId)),
    });
  }
  const saves = paths.savesDir(profileId);
  for (const name of await listDir(saves)) {
    const entry = join(saves, name);
    if (!(await isRealDir(entry)) || !(await exists(join(entry, "level.dat"))))
      continue;
    result.push({ id: name, linked: false, ...(await describe(entry, name)) });
  }
  return result.sort((a, b) =>
    (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""),
  );
}

/**
 * Give a world to another profile: rewrite its flag, then fix both profiles' links.
 * The caller makes sure neither profile has a running game.
 */
export async function moveWorld(
  deps: WorldDeps,
  worldId: string,
  toProfileId: string,
  options: Omit<SyncOptions, "only">,
): Promise<void> {
  const { paths } = deps;
  const dir = paths.worldDir(worldId);
  if (!(await isRealDir(dir))) {
    throw new AppError(
      "WORLD_NOT_LINKED",
      "This world can't be moved: the data folder doesn't support links.",
    );
  }
  if (!options.profileIds.includes(toProfileId))
    throw new AppError("PROFILE_NOT_FOUND", `No profile ${toProfileId}.`);
  const from = await readWorldOwner(paths, worldId);
  await writeOwner(dir, toProfileId);
  await syncWorlds(deps, {
    ...options,
    only: [toProfileId, ...(from ? [from] : [])],
  });
}

/** Delete a world for good: links first, then its folder. */
export async function deleteWorld(
  paths: Paths,
  worldId: string,
): Promise<void> {
  await unlinkEverywhere(paths, worldId);
  await removeTree(paths.worldDir(worldId));
}

/** The worlds a profile owns, by flag (for deleting or moving them with the profile). */
export async function worldsOwnedBy(
  paths: Paths,
  profileId: string,
): Promise<string[]> {
  const owned: string[] = [];
  for (const worldId of await listDir(paths.worldsDir)) {
    if ((await readWorldOwner(paths, worldId)) === profileId)
      owned.push(worldId);
  }
  return owned;
}

/**
 * Real world folders left in a profile's `saves/` (not linked): move them into
 * `worlds/` flagged for `profileId`, so they survive the profile being deleted.
 */
export async function rescueUnlinkedWorlds(
  paths: Paths,
  fromProfileId: string,
  toProfileId: string,
): Promise<void> {
  const saves = paths.savesDir(fromProfileId);
  await mkdir(paths.worldsDir, { recursive: true });
  for (const name of await listDir(saves)) {
    const entry = join(saves, name);
    if (!(await isRealDir(entry)) || !(await exists(join(entry, "level.dat"))))
      continue;
    const worldId = await uniqueWorldId(paths, name);
    await writeOwner(entry, toProfileId);
    await rename(entry, paths.worldDir(worldId));
  }
}
