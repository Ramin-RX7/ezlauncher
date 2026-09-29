import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Profile } from "@shared/launcher";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import { readInstallMarker } from "../minecraft/installer";
import { safeId, type Paths } from "../minecraft/paths";
import type { ProfileStore } from "./profiles";

/*
 * Scopes 01–02 kept one game folder per version (`games/<versionId>/`). Each becomes a
 * profile. Crash-safe and repeatable:
 * 1. write a marker (version id + the new profile id) inside the old folder,
 * 2. rename the folder to `profiles/<profileId>/`,
 * 3. add the profile record, then remove the marker.
 * A crash after 2 leaves a marker with no record; the next start finishes the job.
 */

export const MIGRATION_MARKER = "ezlauncher-migrated.json";
const markerSchema = z.object({
  schema: z.literal(1),
  versionId: z.string(),
  profileId: z.string(),
});

async function listDirs(path: string): Promise<string[]> {
  try {
    const names = await readdir(path);
    const dirs: string[] = [];
    for (const name of names) {
      if ((await stat(join(path, name))).isDirectory()) dirs.push(name);
    }
    return dirs;
  } catch {
    return [];
  }
}

function isSafeId(id: string): boolean {
  try {
    safeId(id);
    return true;
  } catch {
    return false;
  }
}

async function recordFor(
  paths: Paths,
  versionId: string,
  profileId: string,
  createdAt: string,
): Promise<Profile> {
  const marker = await readInstallMarker(paths, versionId);
  const loader = marker?.loader;
  return {
    id: profileId,
    name: versionId.slice(0, 32),
    gameVersion: loader?.gameVersion ?? versionId,
    loader: loader ? { id: loader.id } : null,
    ...(marker && { installedVersionId: versionId }),
    createdAt,
  };
}

/** Turn every `games/<versionId>/` into a profile. Returns the ids of new profiles. */
export async function migrateLegacyGames({
  paths,
  profiles,
  logger,
  now = () => new Date(),
}: {
  paths: Paths;
  profiles: ProfileStore;
  logger?: Logger;
  now?: () => Date;
}): Promise<string[]> {
  const created: string[] = [];

  for (const versionId of await listDirs(paths.legacyGamesDir)) {
    if (!isSafeId(versionId)) {
      logger?.warn(`not migrating games/${versionId}: unusual folder name`);
      continue;
    }
    const oldDir = join(paths.legacyGamesDir, versionId);
    const markerFile = join(oldDir, MIGRATION_MARKER);
    const existing = await readJson(markerFile, markerSchema).catch(
      () => undefined,
    );
    const profileId = existing?.profileId ?? randomUUID();
    if (!existing) {
      await writeJsonAtomic(markerFile, { schema: 1, versionId, profileId });
    }
    await mkdir(paths.profilesDir, { recursive: true });
    await rename(oldDir, paths.gameDir(profileId));
    logger?.info(`migrated games/${versionId} to profile ${profileId}`);
  }

  // Finish every migrated folder that has no record yet (including after a crash).
  const known = new Set((await profiles.list()).map((p) => p.id));
  for (const profileId of await listDirs(paths.profilesDir)) {
    if (!isSafeId(profileId)) continue;
    const markerFile = join(paths.gameDir(profileId), MIGRATION_MARKER);
    const marker = await readJson(markerFile, markerSchema).catch(
      () => undefined,
    );
    if (!marker) continue;
    if (!known.has(profileId)) {
      await profiles.add(
        await recordFor(
          paths,
          marker.versionId,
          profileId,
          now().toISOString(),
        ),
      );
      created.push(profileId);
    }
    await rm(markerFile, { force: true });
  }

  await rmdir(paths.legacyGamesDir).catch(() => undefined); // only if empty
  return created;
}
