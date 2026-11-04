import { mkdir } from "node:fs/promises";
import type {
  AddToWorldsResult,
  DataPackInstallResult,
  DataPackWorld,
  PackDownloadProgress,
  Profile,
  WorldDataPacks,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import { DATAPACK_DOWNLOAD } from "../modsources/downloadPack";
import type { PackLibrary } from "../profiles/packs/library";
import {
  predatesDataPacks,
  type GameFormat,
} from "../profiles/packs/packFormat";
import { packCompat } from "../profiles/packs/packMeta";
import type {
  WorldContext,
  WorldDataPacksApi,
} from "../profiles/packs/worldDataPacks";
import { listWorlds, readWorldOwner } from "../profiles/worlds";
import { createPackKindService, type PackServiceDeps } from "./packs";

export interface DataPackServiceDeps extends PackServiceDeps {
  library: PackLibrary;
  worldDataPacks: WorldDataPacksApi;
  gameFormat: (profile: Profile) => Promise<GameFormat | undefined>;
  openFolder: (dir: string) => Promise<void>;
  progress: (p: PackDownloadProgress) => void;
}

/** A world, the profile that owns it, and what its version knows about data packs. */
interface DataPackTarget {
  profile: Profile;
  context: WorldContext;
}

/** Data packs belong to worlds: a shared library linked into `worlds/<id>/datapacks/`. */
export function createDataPackService(deps: DataPackServiceDeps) {
  const { paths, library, worldDataPacks, runtime, whenReady, changed } = deps;
  const { serialFs, isBusy, assertNotRunning } = runtime;

  /**
   * A world's owner profile, the data pack format that plays it, and whether that
   * version has data packs at all. Worlds still in `saves/` (not synced) aren't found.
   */
  async function dataPackWorld(worldId: unknown): Promise<DataPackTarget> {
    if (typeof worldId !== "string")
      throw new AppError("WORLD_NOT_FOUND", "World not found.");
    let ownerId: string | undefined;
    try {
      ownerId = await readWorldOwner(paths, worldId);
    } catch {
      ownerId = undefined; // not a valid world name
    }
    const profile = ownerId ? await deps.profiles.get(ownerId) : undefined;
    if (!profile) throw new AppError("WORLD_NOT_FOUND", "World not found.");
    const format = await deps.gameFormat(profile);
    return {
      profile,
      context: {
        id: worldId,
        ...(format?.data && { format: format.data }),
        unsupported: predatesDataPacks(profile.gameVersion),
      },
    };
  }

  /** Refuse unless the world's packs may change now: its profile isn't playing, and its version has data packs. */
  function assertEditable(world: DataPackTarget): void {
    assertNotRunning(world.profile.id);
    if (world.context.unsupported)
      throw new AppError(
        "DATAPACKS_UNSUPPORTED",
        "This Minecraft version has no data packs.",
      );
  }

  async function editableWorld(worldId: unknown): Promise<DataPackTarget> {
    const world = await dataPackWorld(worldId);
    assertEditable(world);
    return world;
  }

  const service = createPackKindService<DataPackTarget, DataPackInstallResult>(
    deps,
    {
      library,
      download: DATAPACK_DOWNLOAD,
      inUse: {
        code: "DATAPACK_IN_USE",
        message: "Worlds still have this pack.",
      },
      busyMessage: "This pack is already downloading.",
      async target(worldId) {
        await whenReady();
        return dataPackWorld(worldId);
      },
      gameVersion: (world) => world.profile.gameVersion,
      progress: deps.progress,
      projectIcon: true,
      async addTo(world, sha1s) {
        assertEditable(world);
        await serialFs(async () => {
          for (const sha1 of sha1s)
            await worldDataPacks.add(world.context.id, sha1);
        });
      },
      // A world being played keeps its packs open (locked on Windows).
      async assertUsersIdle(worldIds) {
        for (const worldId of worldIds) {
          const owner = await readWorldOwner(paths, worldId).catch(
            () => undefined,
          );
          if (owner) assertNotRunning(owner);
        }
      },
      result({ target, meta, placed, base, download }) {
        return Promise.resolve({
          ...base,
          compat: packCompat(meta?.range, target?.context.format),
          added: placed,
          needs: download.needs,
        });
      },
    },
  );

  return {
    service,
    api: {
      dataPackLibrary: service.list,
      dataPackIcon: service.icon,

      async dataPackFolderIcon(
        worldId: string,
        name: string,
      ): Promise<string | null> {
        await whenReady();
        if (typeof worldId !== "string" || typeof name !== "string")
          return null;
        return worldDataPacks.folderIcon(worldId, name).catch(() => null);
      },

      /** A world's Data packs dialog: its packs, the library's others, and non-packs. */
      async worldDataPacks(worldId: string): Promise<WorldDataPacks> {
        await whenReady();
        const { profile, context } = await dataPackWorld(worldId);
        const busy = isBusy(profile.id);
        if (!busy) await deps.sync([profile.id]);
        return worldDataPacks.view(context, { running: busy });
      },

      /**
       * Put a library pack in a world, or take it out. Never while the world's
       * profile plays: the game keeps the world's packs open.
       */
      async setDataPackInWorld(
        worldId: string,
        sha1: string,
        present: boolean,
      ): Promise<void> {
        await whenReady();
        await editableWorld(worldId);
        if (typeof sha1 !== "string" || !/^[0-9a-f]{40}$/.test(sha1))
          throw new AppError(
            "DATAPACK_NOT_FOUND",
            "That data pack isn't valid.",
          );
        await serialFs(() =>
          present
            ? worldDataPacks.add(worldId, sha1)
            : worldDataPacks.remove(worldId, sha1),
        );
        changed();
      },

      /** Every world (by profile), with whether it has this pack, for "Add to worlds…". */
      async dataPackWorlds(sha1: string): Promise<DataPackWorld[]> {
        await whenReady();
        const users =
          typeof sha1 === "string" ? await library.usedBy(sha1) : [];
        const worlds: DataPackWorld[] = [];
        for (const p of await deps.profiles.list())
          for (const w of await listWorlds(paths, p.id))
            if (w.linked)
              worlds.push({
                worldId: w.id,
                name: w.name,
                profileId: p.id,
                profileName: p.name,
                hasPack: users.includes(w.id),
                busy: isBusy(p.id),
                unsupported: predatesDataPacks(p.gameVersion),
              });
        return worlds;
      },

      /** Put a library pack in several worlds; ones that can't change now are reported. */
      async addDataPackToWorlds(
        sha1: string,
        worldIds: readonly unknown[],
      ): Promise<AddToWorldsResult> {
        await whenReady();
        const result: AddToWorldsResult = { added: [], failed: [] };
        for (const worldId of Array.isArray(worldIds) ? worldIds : []) {
          if (typeof worldId !== "string") continue;
          try {
            await editableWorld(worldId);
            await serialFs(() => worldDataPacks.add(worldId, sha1));
            result.added.push(worldId);
          } catch (err) {
            result.failed.push({
              worldId,
              code: err instanceof AppError ? err.code : "INTERNAL",
            });
          }
        }
        changed();
        return result;
      },

      /** Add data pack zips to the library; with a world, also put them there. */
      addDataPacks: service.add,
      /** Delete a data pack from the library and every world (`force` when worlds have it). */
      removeDataPack: service.remove,
      removeUnusedDataPacks: service.removeUnused,
      /** Data packs on the mod sites matching `query`, for the world's Minecraft version if given. */
      searchDataPacks: service.search,
      /** Download a data pack into the library; with a world, put it there too. */
      installDataPack: service.install,
      cancelDataPackInstall: service.cancelInstall,

      async openWorldDataPacksFolder(worldId: string): Promise<void> {
        await whenReady();
        await dataPackWorld(worldId);
        await mkdir(paths.worldDataPacksDir(worldId), { recursive: true });
        await deps.openFolder(paths.worldDataPacksDir(worldId));
      },
    },
  };
}
