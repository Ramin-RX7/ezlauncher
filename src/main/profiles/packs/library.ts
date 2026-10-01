import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { LibraryPack } from "@shared/launcher";
import { AppError } from "../../core/errors";
import { readJson, writeJsonAtomic } from "../../core/fsAtomic";
import type { Logger } from "../../core/logger";
import type { Paths } from "../../minecraft/paths";
import { sha1File } from "../../minecraft/verify";
import {
  createLinkedStore,
  exists,
  linkSchema,
  type ReconcileDiff,
} from "../linkedStore";
import { readDataPackZip, readPackZip, type PackRead } from "./packMeta";
import { readShaderZip } from "./shaderMeta";

/*
 * A shared pack library, one per kind (resource packs, shader packs). Every pack
 * zip is stored once as `<store>/<sha1>.zip`; a profile that has it gets a hard
 * link in its pack folder (a copy where hard links don't work). `launcher/
 * <kind>.json` holds each pack's metadata and which file in which profile is which
 * pack. Which packs are active lives in the game's own files (`options.txt` for
 * resource packs, see profilePacks.ts; Iris's config for shaders, see
 * profileShaders.ts). Folder packs are never stored here.
 */

/** What differs between pack kinds: where they live and how a zip is read. */
export interface PackKind {
  /** For log lines and messages ("resource pack"). */
  label: string;
  jsonName: string;
  storeDir: string;
  storeFile: (sha1: string) => string;
  iconFile: (sha1: string) => string;
  profileDir: (profileId: string) => string;
  read: (path: string) => Promise<PackRead>;
  codes: { notPack: string; nested: string; notFound: string };
}

export const resourcePackKind = (paths: Paths): PackKind => ({
  label: "resource pack",
  jsonName: "resourcepacks.json",
  storeDir: paths.resourcePacksStoreDir,
  storeFile: paths.resourcePackStoreFile,
  iconFile: paths.resourcePackIcon,
  profileDir: paths.resourcePacksDir,
  read: readPackZip,
  codes: {
    notPack: "NOT_A_PACK",
    nested: "PACK_NESTED",
    notFound: "PACK_NOT_FOUND",
  },
});

export const shaderPackKind = (paths: Paths): PackKind => ({
  label: "shader pack",
  jsonName: "shaderpacks.json",
  storeDir: paths.shaderPacksStoreDir,
  storeFile: paths.shaderPackStoreFile,
  iconFile: paths.shaderPackIcon,
  profileDir: paths.shaderPacksDir,
  read: readShaderZip,
  codes: {
    notPack: "NOT_A_SHADER",
    nested: "SHADER_NESTED",
    notFound: "SHADER_NOT_FOUND",
  },
});

/**
 * Data packs belong to worlds, not profiles: the library's keys are world ids, and
 * each world's packs live in its own `datapacks/` folder.
 */
export const dataPackKind = (paths: Paths): PackKind => ({
  label: "data pack",
  jsonName: "datapacks.json",
  storeDir: paths.dataPacksStoreDir,
  storeFile: paths.dataPackStoreFile,
  iconFile: paths.dataPackIcon,
  profileDir: paths.worldDataPacksDir,
  read: readDataPackZip,
  codes: {
    notPack: "NOT_A_DATAPACK",
    nested: "DATAPACK_NESTED",
    notFound: "DATAPACK_NOT_FOUND",
  },
});

const formatSchema = z.object({ major: z.number(), minor: z.number() });

const metaSchema = z.object({
  fileName: z.string(),
  description: z.string(),
  range: z.object({ min: formatSchema, max: formatSchema }).optional(),
  /** Experimental features a data pack needs. */
  features: z.array(z.string()).optional(),
  /** The site's loaders for the downloaded version (shaders: `iris`, `optifine`, …). */
  loaders: z.array(z.string()).optional(),
  /** Relative to the store folder. */
  iconPath: z.string().optional(),
  size: z.number(),
  /** The stored file's size and modified time when its SHA1 was last right. */
  verified: z.object({ size: z.number(), mtimeMs: z.number() }).optional(),
  addedAt: z.string(),
  source: z
    .object({
      sourceId: z.string(),
      projectId: z.string(),
      versionId: z.string(),
      pageUrl: z.string(),
    })
    .optional(),
  sourceCheckedAt: z.string().optional(),
});
export type PackMetaRecord = z.infer<typeof metaSchema>;
export type PackSourceRef = NonNullable<PackMetaRecord["source"]>;

const fileSchema = z.object({
  schema: z.literal(1),
  packs: z.record(z.string(), metaSchema),
  /** profileId → file name in its pack folder → the pack it is. */
  links: z.record(z.string(), z.record(z.string(), linkSchema)),
});
type PacksFile = z.infer<typeof fileSchema>;

export interface PackSyncOptions {
  profileIds: readonly string[];
  only?: readonly string[];
  isRunning: (profileId: string) => boolean;
}

/** Packs not identified yet are asked about again after this long. */
export const PACK_RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** The image type of an icon, from its first bytes (site icons aren't always PNG). */
export function imageType(bytes: Uint8Array): string | undefined {
  const at = (i: number, ...b: number[]) =>
    b.every((v, n) => bytes[i + n] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    return "image/webp";
  return undefined;
}

const MAX_ICON = 2 * 1024 * 1024;

const fileState = async (path: string) => {
  const s = await stat(path);
  return { size: s.size, mtimeMs: Math.floor(s.mtimeMs) };
};

export function createPackLibrary({
  paths,
  kind = resourcePackKind(paths),
  logger,
  now = () => new Date(),
}: {
  paths: Paths;
  /** Resource packs unless given. */
  kind?: PackKind;
  logger?: Logger;
  now?: () => Date;
}) {
  const file = paths.launcherFile(kind.jsonName);
  const { codes } = kind;
  const store = createLinkedStore({
    storeDir: kind.storeDir,
    storeFile: kind.storeFile,
    profileDir: kind.profileDir,
    ext: ".zip",
    label: kind.label,
    ...(logger && { logger }),
  });
  const notInLibrary = () =>
    new AppError(codes.notFound, `This ${kind.label} isn't in the library.`);

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function load(): Promise<PacksFile> {
    const data = await readJson(file, fileSchema).catch((err: unknown) => {
      logger?.warn(`${kind.jsonName} is unreadable; starting empty`, err);
      return undefined;
    });
    return data ?? { schema: 1, packs: {}, links: {} };
  }
  const save = (data: PacksFile) => writeJsonAtomic(file, data);

  /** Metadata (and icon) for a stored zip. */
  async function describe(
    sha1: string,
    fileName: string,
  ): Promise<PackMetaRecord> {
    const stored = kind.storeFile(sha1);
    const read = await kind.read(stored);
    if (read.status === "nested")
      throw new AppError(
        codes.nested,
        `${fileName} has its pack one folder down.`,
      );
    if (read.status !== "ok")
      throw new AppError(codes.notPack, `${fileName} isn't a ${kind.label}.`);
    let iconPath: string | undefined;
    if (read.icon) {
      await mkdir(dirname(kind.iconFile(sha1)), { recursive: true });
      await writeFile(kind.iconFile(sha1), read.icon);
      iconPath = `icons/${sha1}.png`;
    }
    const state = await fileState(stored);
    return {
      fileName,
      description: read.meta.description,
      ...(read.meta.range && { range: read.meta.range }),
      ...(read.meta.features && { features: read.meta.features }),
      ...(iconPath && { iconPath }),
      size: state.size,
      verified: state,
      addedAt: now().toISOString(),
    };
  }

  async function ensureMeta(data: PacksFile, sha1: string, fileName: string) {
    data.packs[sha1] ??= await describe(sha1, fileName);
  }

  /**
   * A stored zip edited in place (through a profile's hard link) changes for every
   * profile at once: file it under its new SHA1. The links stay the same file.
   */
  async function rekeyEdited(data: PacksFile): Promise<void> {
    for (const [sha1, meta] of Object.entries(data.packs)) {
      const stored = kind.storeFile(sha1);
      let state;
      try {
        state = await fileState(stored);
      } catch {
        continue;
      }
      if (
        meta.verified?.size === state.size &&
        meta.verified.mtimeMs === state.mtimeMs
      )
        continue;
      const actual = await sha1File(stored);
      if (actual === sha1) {
        meta.verified = state;
        continue;
      }
      try {
        const target = kind.storeFile(actual);
        if (await exists(target)) {
          await rm(stored, { force: true }); // the edited file equals another stored pack
        } else {
          await rename(stored, target);
        }
        await rm(kind.iconFile(sha1), { force: true });
        Reflect.deleteProperty(data.packs, sha1);
        data.packs[actual] ??= await describe(actual, meta.fileName);
        for (const links of Object.values(data.links))
          for (const entry of Object.values(links))
            if (entry.sha1 === sha1) entry.sha1 = actual;
        logger?.info(`${meta.fileName} was edited; stored it again`);
      } catch (err) {
        logger?.warn(`storing the edited ${meta.fileName} failed`, err);
      }
    }
  }

  function toLibraryPack(
    sha1: string,
    meta: PackMetaRecord,
    usedBy: string[],
  ): LibraryPack {
    return {
      sha1,
      fileName: meta.fileName,
      name: meta.fileName.replace(/\.zip$/i, ""),
      description: meta.description,
      hasIcon: meta.iconPath !== undefined,
      size: meta.size,
      addedAt: meta.addedAt,
      usedBy,
      ...(meta.loaders && { loaders: meta.loaders }),
      ...(meta.source && {
        source: {
          sourceId: meta.source.sourceId,
          projectId: meta.source.projectId,
          pageUrl: meta.source.pageUrl,
        },
      }),
      checked: meta.source !== undefined || meta.sourceCheckedAt !== undefined,
    };
  }

  async function removeFromStore(data: PacksFile, sha1: string) {
    await store.removeEverywhere(data.links, sha1);
    await rm(kind.iconFile(sha1), { force: true });
    Reflect.deleteProperty(data.packs, sha1);
  }

  return {
    /**
     * Bring the library and profiles' pack folders in line: adopt pack zips put
     * there by hand (zips that aren't packs stay unstored), drop links whose file is
     * gone, follow renames. Running profiles are skipped. Resolves to each synced
     * profile's changes, so the game's settings can follow renames.
     */
    sync({ profileIds, only, isRunning }: PackSyncOptions): Promise<{
      adopted: number;
      diffs: Map<string, ReconcileDiff>;
    }> {
      return serial(async () => {
        const data = await load();
        const before = new Set(Object.keys(data.packs));
        const known = new Set(profileIds);
        for (const id of Object.keys(data.links))
          if (!known.has(id)) Reflect.deleteProperty(data.links, id);
        await rekeyEdited(data);
        const diffs = new Map<string, ReconcileDiff>();
        for (const id of only ?? profileIds) {
          if (!known.has(id) || isRunning(id)) continue;
          const diff = await store.reconcile(
            (data.links[id] ??= {}),
            id,
            Object.keys(data.packs),
            (sha1, name) => ensureMeta(data, sha1, name),
            async (path) => (await kind.read(path)).status === "ok",
          );
          diffs.set(id, diff);
        }
        const users = store.usage(data.links);
        for (const sha1 of Object.keys(data.packs)) {
          if (users.has(sha1) || (await exists(kind.storeFile(sha1)))) continue;
          Reflect.deleteProperty(data.packs, sha1);
        }
        await save(data);
        const adopted = Object.keys(data.packs).filter(
          (s) => !before.has(s),
        ).length;
        return { adopted, diffs };
      });
    },

    list(): Promise<LibraryPack[]> {
      return serial(async () => {
        const data = await load();
        const users = store.usage(data.links);
        return Object.entries(data.packs)
          .map(([sha1, meta]) =>
            toLibraryPack(sha1, meta, users.get(sha1) ?? []),
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },

    /** Every pack's metadata and one profile's links (file name → SHA1). */
    snapshot(profileId: string): Promise<{
      packs: Record<string, PackMetaRecord>;
      links: Record<string, string>;
    }> {
      return serial(async () => {
        const data = await load();
        const links = Object.fromEntries(
          Object.entries(data.links[profileId] ?? {}).map(([name, e]) => [
            name,
            e.sha1,
          ]),
        );
        return { packs: data.packs, links };
      });
    },

    /** Add pack zips from anywhere (file picker, drag and drop). */
    add(
      files: readonly string[],
    ): Promise<
      (
        | { ok: true; sha1: string; added: boolean; fileName: string }
        | { ok: false; fileName: string; code: string }
      )[]
    > {
      return serial(async () => {
        const data = await load();
        const results = [];
        for (const path of files) {
          const fileName = basename(path);
          const read = await kind.read(path);
          if (read.status !== "ok") {
            results.push({
              ok: false as const,
              fileName,
              code: read.status === "nested" ? codes.nested : codes.notPack,
            });
            continue;
          }
          try {
            const { sha1, added } = await store.storeCopy(path);
            await ensureMeta(data, sha1, fileName);
            results.push({ ok: true as const, sha1, added, fileName });
          } catch (err) {
            results.push({
              ok: false as const,
              fileName,
              code: err instanceof AppError ? err.code : "INTERNAL",
            });
          }
        }
        await save(data);
        return results;
      });
    },

    /** Zips downloaded straight into the store, with where they came from. */
    addStored(
      files: readonly {
        sha1: string;
        fileName: string;
        source: PackSourceRef;
        loaders?: readonly string[];
      }[],
    ): Promise<void> {
      return serial(async () => {
        const data = await load();
        for (const f of files) {
          if (!(await exists(kind.storeFile(f.sha1))))
            throw new AppError(codes.notFound, `${f.fileName} isn't stored.`);
          await ensureMeta(data, f.sha1, f.fileName);
          const meta = data.packs[f.sha1];
          if (meta) {
            meta.source = f.source;
            meta.sourceCheckedAt = now().toISOString();
            if (f.loaders) meta.loaders = [...f.loaders];
          }
        }
        await save(data);
      });
    },

    /** The stored zip of a pack (it may not exist yet). */
    storeFile: kind.storeFile,

    /** Give a pack without one an icon from elsewhere (its project's icon on a site). */
    setIcon(sha1: string, image: Uint8Array): Promise<void> {
      return serial(async () => {
        const data = await load();
        const meta = data.packs[sha1];
        if (!meta || meta.iconPath) return;
        if (image.length > MAX_ICON || !imageType(image)) return;
        await mkdir(dirname(kind.iconFile(sha1)), { recursive: true });
        await writeFile(kind.iconFile(sha1), image);
        meta.iconPath = `icons/${sha1}.png`;
        await save(data);
      });
    },

    /** Link a pack into a profile (if it isn't); resolves to its file name there. */
    link(profileId: string, sha1: string): Promise<string> {
      return serial(async () => {
        const data = await load();
        const meta = data.packs[sha1];
        if (!meta || !(await exists(kind.storeFile(sha1))))
          throw notInLibrary();
        const links = (data.links[profileId] ??= {});
        for (const [name, entry] of Object.entries(links)) {
          if (entry.sha1 !== sha1) continue;
          if (await exists(join(kind.profileDir(profileId), name))) return name;
          Reflect.deleteProperty(links, name); // removed by hand since
        }
        const { name } = await store.linkInto(
          links,
          profileId,
          sha1,
          meta.fileName,
        );
        await save(data);
        return name;
      });
    },

    /** Remove a pack's file from a profile; the pack stays in the library. */
    unlink(profileId: string, sha1: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        const links = data.links[profileId] ?? {};
        for (const [name, entry] of Object.entries(links)) {
          if (entry.sha1 !== sha1) continue;
          await store.unlinkIfOurs(profileId, name, entry);
          Reflect.deleteProperty(links, name);
        }
        await save(data);
      });
    },

    usedBy(sha1: string): Promise<string[]> {
      return serial(
        async () => store.usage((await load()).links).get(sha1) ?? [],
      );
    },

    meta(sha1: string): Promise<PackMetaRecord | undefined> {
      return serial(async () => (await load()).packs[sha1]);
    },

    /** Delete a pack from the library and every profile. */
    remove(sha1: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        if (!data.packs[sha1]) throw notInLibrary();
        await removeFromStore(data, sha1);
        await save(data);
      });
    },

    /** Delete every pack no profile has. Resolves to how many. */
    removeUnused(): Promise<number> {
      return serial(async () => {
        const data = await load();
        const users = store.usage(data.links);
        const unused = Object.keys(data.packs).filter((s) => !users.has(s));
        for (const sha1 of unused) await removeFromStore(data, sha1);
        await save(data);
        return unused.length;
      });
    },

    forgetProfile(profileId: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        Reflect.deleteProperty(data.links, profileId);
        await save(data);
      });
    },

    /** Packs not identified yet: never asked, or asked over a week ago with no match. */
    pendingIdentification(): Promise<string[]> {
      return serial(async () => {
        const data = await load();
        const cutoff = now().getTime() - PACK_RECHECK_AFTER_MS;
        return Object.entries(data.packs)
          .filter(
            ([, m]) =>
              !m.source &&
              (!m.sourceCheckedAt || Date.parse(m.sourceCheckedAt) < cutoff),
          )
          .map(([sha1]) => sha1);
      });
    },

    recordIdentification(
      checked: readonly string[],
      matches: ReadonlyMap<
        string,
        { source: PackSourceRef; loaders?: readonly string[] }
      >,
    ): Promise<number> {
      return serial(async () => {
        const data = await load();
        let found = 0;
        for (const sha1 of checked) {
          const meta = data.packs[sha1];
          if (!meta) continue;
          meta.sourceCheckedAt = now().toISOString();
          const match = matches.get(sha1);
          if (match && !meta.source) {
            meta.source = match.source;
            if (match.loaders) meta.loaders = [...match.loaders];
            found++;
          }
        }
        await save(data);
        return found;
      });
    },

    async icon(sha1: string): Promise<string | null> {
      try {
        const bytes = await readFile(kind.iconFile(sha1));
        const type = imageType(bytes) ?? "image/png";
        return `data:${type};base64,${bytes.toString("base64")}`;
      } catch {
        return null;
      }
    },
  };
}

export type PackLibrary = ReturnType<typeof createPackLibrary>;
