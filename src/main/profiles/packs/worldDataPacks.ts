import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackRef, WorldDataPack, WorldDataPacks } from "@shared/launcher";
import type { Logger } from "../../core/logger";
import type { Paths } from "../../minecraft/paths";
import { readDataPackState, type DataPackState } from "../nbt";
import type { PackLibrary, PackMetaRecord } from "./library";
import type { PackFormat } from "./packFormat";
import {
  packCompat,
  readDataPackFolder,
  readDataPackZip,
  type PackRead,
} from "./packMeta";

/*
 * A world's data packs. They live in the world's own `datapacks/` folder, and the
 * game turns on any new file there by itself when the world loads (and drops
 * entries whose file is gone), so adding a pack is linking its file in and removing
 * it is unlinking it. The world's `level.dat` is only ever read: it says which
 * packs were turned off in game and which experimental features the world has.
 * The caller makes sure the world's profile isn't running.
 */

/** Packs that need features the world lacks aren't loaded; a world without the list has only these. */
const DEFAULT_FEATURES = ["minecraft:vanilla"];

export interface WorldContext {
  id: string;
  /** The data format of the version that plays it (its owner profile's). */
  format?: PackFormat;
  /** That version has no data packs (before 1.13). */
  unsupported: boolean;
}

export function createWorldDataPacks({
  paths,
  library,
  logger,
}: {
  paths: Paths;
  /** The data pack library (`dataPackKind`): keyed by world id. */
  library: PackLibrary;
  logger?: Logger;
}) {
  async function levelState(worldId: string): Promise<DataPackState> {
    try {
      return readDataPackState(
        new Uint8Array(await readFile(paths.worldLevelDat(worldId))),
      );
    } catch (err) {
      logger?.info(`couldn't read the data packs of ${worldId}`, err);
      return { enabled: [], disabled: [], features: [] };
    }
  }

  async function folders(
    worldId: string,
  ): Promise<{ name: string; read: PackRead }[]> {
    let entries;
    try {
      entries = await readdir(paths.worldDataPacksDir(worldId), {
        withFileTypes: true,
      });
    } catch {
      return [];
    }
    const found = [];
    for (const entry of entries)
      if (entry.isDirectory())
        found.push({
          name: entry.name,
          read: await readDataPackFolder(
            join(paths.worldDataPacksDir(worldId), entry.name),
          ),
        });
    return found;
  }

  return {
    /** A world's Data packs dialog. */
    async view(
      world: WorldContext,
      { running }: { running: boolean },
    ): Promise<WorldDataPacks> {
      const { packs, links } = await library.snapshot(world.id);
      const state = await levelState(world.id);
      const features =
        state.features.length > 0 ? state.features : DEFAULT_FEATURES;
      const found = await folders(world.id);

      const row = (
        ref: PackRef,
        name: string,
        entry: string,
        meta: Pick<PackMetaRecord, "description" | "range" | "features"> & {
          hasIcon: boolean;
        },
        source?: PackMetaRecord["source"],
      ): WorldDataPack => ({
        ref,
        name,
        description: meta.description,
        hasIcon: meta.hasIcon,
        compat: packCompat(meta.range, world.format),
        offInGame: state.disabled.includes(`file/${entry}`),
        missingFeatures: (meta.features ?? []).filter(
          (f) => !features.includes(f),
        ),
        ...(source && {
          source: {
            sourceId: source.sourceId,
            projectId: source.projectId,
            pageUrl: source.pageUrl,
          },
        }),
      });
      const libraryRow = (sha1: string, meta: PackMetaRecord, entry: string) =>
        row(
          { kind: "library", sha1 },
          meta.fileName.replace(/\.zip$/i, ""),
          entry,
          { ...meta, hasIcon: meta.iconPath !== undefined },
          meta.source,
        );

      const byName = (a: WorldDataPack, b: WorldDataPack) =>
        a.name.localeCompare(b.name);
      const linked = new Set<string>();
      const inWorld: WorldDataPack[] = [];
      for (const [name, sha1] of Object.entries(links)) {
        const meta = packs[sha1];
        if (!meta || linked.has(sha1)) continue;
        linked.add(sha1);
        inWorld.push(libraryRow(sha1, meta, name));
      }
      for (const f of found)
        if (f.read.status === "ok")
          inWorld.push(
            row({ kind: "folder", name: f.name }, f.name, f.name, {
              ...f.read.meta,
              hasIcon: f.read.icon !== undefined,
            }),
          );
      const available = Object.entries(packs)
        .filter(([sha1]) => !linked.has(sha1))
        .map(([sha1, meta]) => libraryRow(sha1, meta, meta.fileName))
        .sort(byName);

      const notPacks: WorldDataPacks["notPacks"] = [];
      for (const f of found)
        if (f.read.status === "nested")
          notPacks.push({
            name: f.name,
            reason: "nested",
            folder: f.read.folder,
          });
      let zips: string[] = [];
      try {
        zips = (await readdir(paths.worldDataPacksDir(world.id))).filter(
          (n) => /\.zip$/i.test(n) && links[n] === undefined,
        );
      } catch {
        // no folder yet
      }
      for (const name of zips) {
        const read = await readDataPackZip(
          join(paths.worldDataPacksDir(world.id), name),
        );
        if (read.status === "ok") continue; // adopted on the next sync
        notPacks.push({
          name,
          reason: read.status,
          ...(read.status === "nested" && { folder: read.folder }),
        });
      }

      const locked: WorldDataPacks["locked"] = world.unsupported
        ? "unsupported"
        : running
          ? "running"
          : undefined;
      return {
        inWorld: inWorld.sort(byName),
        available,
        notPacks,
        ...(locked && { locked }),
      };
    },

    /** Put a library pack in a world; the game turns it on the next time the world loads. */
    async add(worldId: string, sha1: string): Promise<void> {
      await library.link(worldId, sha1);
    },

    /** Take a library pack out of a world (it stays in the library). */
    async remove(worldId: string, sha1: string): Promise<void> {
      await library.unlink(worldId, sha1);
    },

    /** The icon of a folder pack, as a data URL. */
    async folderIcon(worldId: string, name: string): Promise<string | null> {
      const read = await readDataPackFolder(
        paths.folderDataPackDir(worldId, name),
      );
      return read.status === "ok" && read.icon
        ? `data:image/png;base64,${Buffer.from(read.icon).toString("base64")}`
        : null;
    },
  };
}

export type WorldDataPacksApi = ReturnType<typeof createWorldDataPacks>;
