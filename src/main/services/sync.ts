import { readdir } from "node:fs/promises";
import type { Profile } from "@shared/launcher";
import type { Logger } from "../core/logger";
import type { Paths } from "../minecraft/paths";
import type { ReconcileDiff } from "../profiles/linkedStore";
import { isLink } from "../profiles/links";
import type { ModLibrary } from "../profiles/mods";
import type { PackLibrary } from "../profiles/packs/library";
import type { ProfilePacksApi } from "../profiles/packs/profilePacks";
import type { ProfileShadersApi } from "../profiles/packs/profileShaders";
import type { ProfileStore } from "../profiles/profiles";
import { syncScreenshots } from "../profiles/screenshots";
import { readWorldOwner, syncWorlds } from "../profiles/worlds";
import type { Runtime } from "./runtime";

export interface SyncDeps {
  paths: Paths;
  profiles: Pick<ProfileStore, "list" | "get">;
  mods: Pick<ModLibrary, "sync">;
  packs: PackLibrary;
  shaders: PackLibrary;
  /** Keyed by world id. */
  dataPacks: PackLibrary;
  profilePacks: Pick<ProfilePacksApi, "followSync">;
  profileShaders: Pick<ProfileShadersApi, "followSync">;
  runtime: Runtime;
  /** Files were adopted into a library: a site may know them (asked a little later). */
  onAdopted: () => void;
  logger: Logger;
}

/**
 * Bring the folders and the launcher's records together: worlds made or deleted in
 * game, screenshots, and mods/packs added, removed or renamed by hand. One run at a
 * time (the folder queue); profiles that play are left alone.
 */
export function createSync(deps: SyncDeps) {
  const {
    paths,
    profiles,
    mods,
    packs,
    shaders,
    dataPacks,
    profilePacks,
    profileShaders,
  } = deps;
  const { serialFs, isRunning } = deps.runtime;
  const log = deps.logger;

  async function worldOptions() {
    return {
      profileIds: (await profiles.list()).map((p) => p.id),
      isRunning,
    };
  }

  /** World, mod and pack sync for some (default: all) profiles; running ones are skipped. */
  function sync(only?: string[]): Promise<void> {
    return serialFs(async () => {
      const options = { ...(await worldOptions()), ...(only && { only }) };
      const result = await syncWorlds({ paths, logger: log }, options);
      for (const u of result.unlinked)
        log.warn(`world ${u.worldId} of ${u.profileId} isn't linked`);
      await syncScreenshots({ paths, logger: log }, options);
      if ((await mods.sync(options)) > 0) deps.onAdopted();
      await syncPackKind(options, packs, paths.resourcePacksDir, (p, diff) =>
        profilePacks.followSync(p, diff),
      );
      await syncPackKind(options, shaders, paths.shaderPacksDir, (p, diff) =>
        profileShaders.followSync(p, diff),
      );
      await syncDataPacks(options);
    });
  }

  /** Every world in `worlds/` and the profile that owns it. */
  async function worldOwners(): Promise<Map<string, string | undefined>> {
    let names: string[] = [];
    try {
      names = (await readdir(paths.worldsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // no worlds yet
    }
    const owners = new Map<string, string | undefined>();
    for (const id of names) owners.set(id, await readWorldOwner(paths, id));
    return owners;
  }

  /**
   * Data pack sync, by world: every world is a key (a world that's gone drops its
   * links), only the worlds of `only`'s profiles are reconciled, and a world counts
   * as running when its profile does. The game itself turns new files on.
   */
  async function syncDataPacks(options: {
    profileIds: string[];
    only?: string[];
    isRunning: (id: string) => boolean;
  }): Promise<void> {
    const owners = await worldOwners();
    const only = options.only;
    const worlds = only
      ? [...owners]
          .filter(([, owner]) => owner !== undefined && only.includes(owner))
          .map(([worldId]) => worldId)
      : undefined;
    await syncPackKind(
      {
        profileIds: [...owners.keys()],
        ...(worlds && { only: worlds }),
        isRunning: (worldId) => {
          const owner = owners.get(worldId);
          return owner !== undefined && options.isRunning(owner);
        },
      },
      dataPacks,
      paths.worldDataPacksDir,
      () => Promise.resolve(), // nothing else names a world's packs
    );
  }

  /** Pack sync for one kind; the game's settings follow files renamed by hand. */
  async function syncPackKind(
    options: {
      profileIds: string[];
      only?: string[];
      isRunning: (id: string) => boolean;
    },
    library: PackLibrary,
    folderOf: (profileId: string) => string,
    follow: (profile: Profile, diff: ReconcileDiff) => Promise<void>,
  ): Promise<void> {
    // A pack folder that is itself a link (shared with something else) is left alone.
    const shared = new Set<string>();
    for (const id of options.only ?? options.profileIds)
      if (await isLink(folderOf(id))) shared.add(id);
    const { adopted, diffs } = await library.sync({
      ...options,
      isRunning: (id) => options.isRunning(id) || shared.has(id),
    });
    for (const [id, diff] of diffs) {
      const profile = await profiles.get(id);
      if (!profile) continue;
      await follow(profile, diff).catch((err: unknown) => {
        log.warn(`updating ${id}'s packs after sync failed`, err);
      });
    }
    if (adopted > 0) deps.onAdopted();
  }

  return { sync, worldOptions };
}

export type Sync = ReturnType<typeof createSync>;
