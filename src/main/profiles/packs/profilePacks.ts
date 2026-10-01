import { copyFile, cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  ActivePack,
  ActivePackRef,
  Profile,
  ProfilePack,
  ProfilePacks,
} from "@shared/launcher";
import { AppError } from "../../core/errors";
import { writeFileAtomic } from "../../core/fsAtomic";
import type { Logger } from "../../core/logger";
import type { Paths } from "../../minecraft/paths";
import {
  entryName,
  newOptionsText,
  packEntry,
  readPackLists,
  writePackLists,
  type PackLists,
} from "../gameOptions";
import { exists, type ReconcileDiff } from "../linkedStore";
import type { PackLibrary, PackMetaRecord } from "./library";
import {
  optionsDialect,
  predatesResourcePacks,
  type GameFormat,
  type OptionsDialect,
} from "./packFormat";
import {
  packCompat,
  readPackFolder,
  readPackZip,
  type PackRange,
  type PackRead,
} from "./packMeta";

/*
 * A profile's resource packs: which are active and in what order (only ever in its
 * `options.txt`), what else it could use, and its folder packs. The caller makes
 * sure no game of the profile runs while anything here writes.
 */

type ProfileLike = Pick<Profile, "id" | "gameVersion">;

/** The active pack list the renderer sends (checked before use). */
export const activePacksSchema = z.array(
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("library"),
      sha1: z.string().regex(/^[0-9a-f]{40}$/),
    }),
    z.object({ kind: z.literal("folder"), name: z.string().min(1).max(255) }),
    z.object({ kind: z.literal("builtin"), id: z.string().min(1).max(255) }),
  ]),
);

const EOL = process.platform === "win32" ? "\r\n" : "\n";

export function createProfilePacks({
  paths,
  library,
  gameFormat,
  logger,
}: {
  paths: Paths;
  library: PackLibrary;
  /** The resource format of the profile's Minecraft version, when known. */
  gameFormat: (profile: ProfileLike) => Promise<GameFormat | undefined>;
  logger?: Logger;
}) {
  async function readOptions(profileId: string): Promise<string | undefined> {
    try {
      return await readFile(paths.optionsFile(profileId), "utf8");
    } catch {
      return undefined;
    }
  }

  async function context(profile: ProfileLike) {
    const format = await gameFormat(profile);
    return {
      format,
      unsupported: predatesResourcePacks(profile.gameVersion),
      dialect: format ? optionsDialect(format.resource) : undefined,
    };
  }

  /** Unzipped pack folders in the profile's `resourcepacks/` (links are left out). */
  async function folders(
    profileId: string,
  ): Promise<{ name: string; read: PackRead }[]> {
    let entries;
    try {
      entries = await readdir(paths.resourcePacksDir(profileId), {
        withFileTypes: true,
      });
    } catch {
      return [];
    }
    const found = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      found.push({
        name: entry.name,
        read: await readPackFolder(
          join(paths.resourcePacksDir(profileId), entry.name),
        ),
      });
    }
    return found;
  }

  const compatOf = (range: PackRange | undefined, format?: GameFormat) =>
    packCompat(range, format?.resource);

  function libraryPack(
    sha1: string,
    meta: PackMetaRecord,
    format?: GameFormat,
  ): ProfilePack {
    return {
      ref: { kind: "library", sha1 },
      name: meta.fileName.replace(/\.zip$/i, ""),
      description: meta.description,
      hasIcon: meta.iconPath !== undefined,
      compat: compatOf(meta.range, format),
      ...(meta.source && {
        source: {
          sourceId: meta.source.sourceId,
          projectId: meta.source.projectId,
          pageUrl: meta.source.pageUrl,
        },
      }),
    };
  }

  function folderPack(
    name: string,
    read: Extract<PackRead, { status: "ok" }>,
    format?: GameFormat,
  ): ProfilePack {
    return {
      ref: { kind: "folder", name },
      name,
      description: read.meta.description,
      hasIcon: read.icon !== undefined,
      compat: compatOf(read.meta.range, format),
    };
  }

  /** Write the pack lists, keeping a copy of the file from before the first change. */
  async function save(
    profileId: string,
    text: string | undefined,
    lists: PackLists,
    worldVersion: number | undefined,
  ): Promise<void> {
    const path = paths.optionsFile(profileId);
    try {
      if (text !== undefined && !(await exists(paths.optionsBackup(profileId))))
        await copyFile(path, paths.optionsBackup(profileId));
      await writeFileAtomic(
        path,
        text === undefined
          ? newOptionsText(lists, worldVersion, EOL)
          : writePackLists(text, lists),
      );
    } catch (err) {
      throw new AppError(
        "OPTIONS_UNWRITABLE",
        "Couldn't save the game's options.txt.",
        { cause: err },
      );
    }
  }

  return {
    /** The profile's Resource packs tab. */
    async view(
      profile: ProfileLike,
      { running }: { running: boolean },
    ): Promise<ProfilePacks> {
      const { format, unsupported, dialect } = await context(profile);
      const { packs, links } = await library.snapshot(profile.id);
      const text = await readOptions(profile.id);
      const lists = text
        ? readPackLists(text)
        : { packs: [], incompatible: [] };
      const found = await folders(profile.id);
      const okFolders = new Map(
        found.flatMap((f) =>
          f.read.status === "ok" ? [[f.name, f.read] as const] : [],
        ),
      );
      // Read entries the way this version writes them; unknown: as modern versions do.
      const readAs: OptionsDialect = dialect ?? "modern";

      const active: ActivePack[] = [];
      const activeKeys = new Set<string>();
      for (const entry of [...lists.packs].reverse()) {
        const name = entryName(entry, readAs);
        if (name === undefined) {
          active.push({ kind: "builtin", id: entry });
          continue;
        }
        const sha1 = links[name];
        const meta = sha1 ? packs[sha1] : undefined;
        if (sha1 && meta) {
          if (activeKeys.has(`l:${sha1}`)) continue;
          activeKeys.add(`l:${sha1}`);
          active.push({ kind: "pack", pack: libraryPack(sha1, meta, format) });
          continue;
        }
        const folder = okFolders.get(name);
        if (folder && !activeKeys.has(`f:${name}`)) {
          activeKeys.add(`f:${name}`);
          active.push({ kind: "pack", pack: folderPack(name, folder, format) });
        }
        // Anything else is a missing file: the game drops it on start.
      }

      const available = [
        ...Object.entries(packs)
          .filter(([sha1]) => !activeKeys.has(`l:${sha1}`))
          .map(([sha1, meta]) => libraryPack(sha1, meta, format)),
        ...[...okFolders]
          .filter(([name]) => !activeKeys.has(`f:${name}`))
          .map(([name, read]) => folderPack(name, read, format)),
      ].sort((a, b) => a.name.localeCompare(b.name));

      const notPacks: ProfilePacks["notPacks"] = [];
      for (const f of found)
        if (f.read.status === "nested")
          notPacks.push({
            name: f.name,
            reason: "nested",
            folder: f.read.folder,
          });
      let zips: string[] = [];
      try {
        zips = (await readdir(paths.resourcePacksDir(profile.id))).filter(
          (n) => /\.zip$/i.test(n) && links[n] === undefined,
        );
      } catch {
        // no folder yet
      }
      for (const name of zips) {
        const read = await readPackZip(
          join(paths.resourcePacksDir(profile.id), name),
        );
        if (read.status === "ok") continue; // adopted on the next sync
        notPacks.push({
          name,
          reason: read.status,
          ...(read.status === "nested" && { folder: read.folder }),
        });
      }

      const locked: ProfilePacks["locked"] = unsupported
        ? "unsupported"
        : running
          ? "running"
          : dialect === undefined
            ? "versionUnknown"
            : undefined;
      return { active, available, notPacks, ...(locked && { locked }) };
    },

    /**
     * Save the active packs, highest priority first. Library packs are linked into
     * the profile; ones no longer active are unlinked. Built-in packs can be kept,
     * moved or dropped, never added.
     */
    async setActive(
      profile: ProfileLike,
      order: readonly ActivePackRef[],
    ): Promise<void> {
      const { format, unsupported, dialect } = await context(profile);
      if (unsupported)
        throw new AppError(
          "PACKS_UNSUPPORTED",
          "This Minecraft version uses texture packs.",
        );
      if (!dialect || !format)
        throw new AppError(
          "PACKS_VERSION_UNKNOWN",
          "Install or launch this profile once first.",
        );
      const text = await readOptions(profile.id);
      const current = text
        ? readPackLists(text)
        : { packs: [], incompatible: [] };
      const before = await library.snapshot(profile.id);
      const folderReads = new Map(
        (await folders(profile.id)).flatMap((f) =>
          f.read.status === "ok" ? [[f.name, f.read] as const] : [],
        ),
      );

      const entries: string[] = []; // highest priority first
      const incompatible: string[] = [];
      const keptLibrary = new Set<string>();
      for (const ref of order) {
        if (ref.kind === "builtin") {
          if (dialect === "modern" && current.packs.includes(ref.id))
            entries.push(ref.id);
          continue;
        }
        let entry: string;
        let range: PackRange | undefined;
        if (ref.kind === "library") {
          const name = await library.link(profile.id, ref.sha1);
          keptLibrary.add(ref.sha1);
          entry = packEntry(name, dialect);
          range = before.packs[ref.sha1]?.range;
        } else {
          const read = folderReads.get(ref.name);
          if (!read)
            throw new AppError(
              "PACK_NOT_FOUND",
              `${ref.name} isn't a pack folder.`,
            );
          entry = packEntry(ref.name, dialect);
          range = read.meta.range;
        }
        if (entries.includes(entry)) continue;
        entries.push(entry);
        const compat = compatOf(range, format);
        if (compat === "tooOld" || compat === "tooNew")
          incompatible.push(entry);
      }

      // Library packs that were active and aren't any more leave the profile.
      for (const entry of current.packs) {
        const name = entryName(entry, dialect);
        const sha1 = name === undefined ? undefined : before.links[name];
        if (sha1 && !keptLibrary.has(sha1))
          await library.unlink(profile.id, sha1);
      }

      const isUserPack = (e: string) => entryName(e, dialect) !== undefined;
      await save(
        profile.id,
        text,
        {
          packs: entries.reverse(),
          incompatible: [
            ...current.incompatible.filter((e) => !isUserPack(e)),
            ...incompatible,
          ],
        },
        format.worldVersion,
      );
    },

    /** After a sync: follow files renamed by hand, drop entries whose file is gone. */
    async followSync(profile: ProfileLike, diff: ReconcileDiff): Promise<void> {
      if (diff.renamed.length === 0 && diff.removed.length === 0) return;
      const { dialect } = await context(profile);
      const text = await readOptions(profile.id);
      if (!dialect || text === undefined) return;
      const renamed = new Map(
        diff.renamed.map((r) => [
          packEntry(r.from, dialect),
          packEntry(r.to, dialect),
        ]),
      );
      const removed = new Set(diff.removed.map((n) => packEntry(n, dialect)));
      const fix = (list: string[]) =>
        list.filter((e) => !removed.has(e)).map((e) => renamed.get(e) ?? e);
      const lists = readPackLists(text);
      const fixed = {
        packs: fix(lists.packs),
        incompatible: fix(lists.incompatible),
      };
      if (JSON.stringify(fixed) === JSON.stringify(lists)) return;
      await save(profile.id, text, fixed, undefined);
      logger?.info(`followed renamed resource packs in ${profile.id}`);
    },

    /**
     * A duplicated profile gets the same active packs in the same order (only the
     * pack lines of `options.txt`). `to` must be new, with no options.txt yet.
     */
    async copyActive(from: ProfileLike, to: ProfileLike): Promise<void> {
      const { format, dialect } = await context(from);
      const text = await readOptions(from.id);
      if (!dialect || text === undefined) return;
      const { links } = await library.snapshot(from.id);
      const lists = readPackLists(text);
      const mapped = new Map<string, string>();
      for (const entry of lists.packs) {
        const name = entryName(entry, dialect);
        if (name === undefined) {
          mapped.set(entry, entry);
          continue;
        }
        const sha1 = links[name];
        if (sha1) {
          mapped.set(
            entry,
            packEntry(await library.link(to.id, sha1), dialect),
          );
        } else if (await exists(paths.folderPackDir(from.id, name))) {
          await cp(
            paths.folderPackDir(from.id, name),
            paths.folderPackDir(to.id, name),
            {
              recursive: true,
              errorOnExist: false,
            },
          );
          mapped.set(entry, entry);
        }
      }
      const map = (list: string[]) =>
        list.flatMap((e) => {
          const m = mapped.get(e);
          return m === undefined ? [] : [m];
        });
      await save(
        to.id,
        undefined,
        { packs: map(lists.packs), incompatible: map(lists.incompatible) },
        format?.worldVersion,
      );
    },

    /** The profile's version moved across 1.13: rewrite entries the new way. */
    async translate(
      profile: ProfileLike,
      from: OptionsDialect,
      to: OptionsDialect,
    ): Promise<void> {
      if (from === to) return;
      const text = await readOptions(profile.id);
      if (text === undefined) return;
      const convert = (list: string[]) =>
        list.flatMap((e) => {
          const name = entryName(e, from);
          return name === undefined ? [] : [packEntry(name, to)];
        });
      const lists = readPackLists(text);
      await save(
        profile.id,
        text,
        {
          packs: convert(lists.packs),
          incompatible: convert(lists.incompatible),
        },
        undefined,
      );
    },

    /** The icon of a folder pack, as a data URL. */
    async folderIcon(profileId: string, name: string): Promise<string | null> {
      const read = await readPackFolder(paths.folderPackDir(profileId, name));
      return read.status === "ok" && read.icon
        ? `data:image/png;base64,${Buffer.from(read.icon).toString("base64")}`
        : null;
    },

    /** The options dialect of a profile's version, when known. */
    async dialectOf(profile: ProfileLike): Promise<OptionsDialect | undefined> {
      return (await context(profile)).dialect;
    },
  };
}

export type ProfilePacksApi = ReturnType<typeof createProfilePacks>;
