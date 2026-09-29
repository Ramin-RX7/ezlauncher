import { randomBytes } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import type { LibraryMod, Profile } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import type { Paths } from "../minecraft/paths";
import { sha1File } from "../minecraft/verify";
import { checkCompat, rangeText } from "./compat";
import { isDependencyOnly, libraryNeededBy } from "./libraryDeps";
import { createHardLink, sameFile } from "./links";
import { readModInfo } from "./modInfo";

/*
 * The shared mod library. Every jar is stored once as `mods-store/<sha1>.jar`;
 * a profile that uses it has a hard link to it in its `mods/` folder (or a copy
 * where hard links don't work). `launcher/mods.json` holds each mod's metadata and
 * which file in which profile belongs to which mod.
 */

const depSchema = z.object({
  id: z.string(),
  range: z.union([z.string(), z.array(z.string())]),
  format: z.enum(["semver", "maven"]),
});

/** Bump when `describe()` reads more from jars: older entries are read again on sync. */
export const INFO_VERSION = 2;

const metaSchema = z.object({
  fileName: z.string(),
  modId: z.string().optional(),
  name: z.string(),
  version: z.string().optional(),
  loaders: z.array(z.string()),
  mcVersionRange: z.union([z.string(), z.array(z.string())]).optional(),
  rangeFormat: z.enum(["semver", "maven"]).optional(),
  depends: z.array(depSchema).optional(),
  breaks: z.array(depSchema).optional(),
  conflicts: z.array(depSchema).optional(),
  provides: z.array(z.string()).optional(),
  nested: z
    .array(
      z.object({
        modId: z.string(),
        version: z.string().optional(),
        provides: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  /** Bytes, when it entered the library (the quick damage check). */
  size: z.number().optional(),
  /** When the file's SHA1 was last found right (the full damage check). */
  verified: z.object({ size: z.number(), mtimeMs: z.number() }).optional(),
  /** Which `describe()` wrote this; missing = 1. */
  infoVersion: z.number().optional(),
  /** Relative to `mods-store/`. */
  iconPath: z.string().optional(),
  addedAt: z.string(),
  /** Where the mod came from (downloaded, or identified by its hash). Opaque to the library. */
  source: z
    .object({
      sourceId: z.string(),
      projectId: z.string(),
      versionId: z.string(),
      pageUrl: z.string(),
      /** What the site says; only used where the jar says nothing (Scope 05). */
      loaders: z.array(z.string()).optional(),
      gameVersions: z.array(z.string()).optional(),
    })
    .optional(),
  /** When the mod sources were last asked about this file. */
  sourceCheckedAt: z.string().optional(),
  /**
   * How it entered the library: added by the user, or pulled in as another mod's
   * dependency. Missing (older entries) = inferred from the other mods' metadata.
   */
  addedAs: z.enum(["user", "dependency"]).optional(),
});
export type ModMeta = z.infer<typeof metaSchema>;
export type ModSourceRef = NonNullable<ModMeta["source"]>;

/** Hand-added mods no source knows are asked about again after this long. */
export const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const linkSchema = z.object({
  sha1: z.string(),
  /** A copy, because hard links didn't work on this drive. */
  copied: z.boolean().optional(),
});

const fileSchema = z.object({
  schema: z.literal(1),
  mods: z.record(z.string(), metaSchema),
  /** profileId → file name in its `mods/` → the mod it is. */
  links: z.record(z.string(), z.record(z.string(), linkSchema)),
});
type ModsFile = z.infer<typeof fileSchema>;

export interface ModSyncOptions {
  profileIds: readonly string[];
  only?: readonly string[];
  isRunning: (profileId: string) => boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function identity(path: string): Promise<string | undefined> {
  try {
    const s = await stat(path, { bigint: true });
    return `${s.dev}:${s.ino}`;
  } catch {
    return undefined;
  }
}

async function jarFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const jars: string[] = [];
  for (const name of names) {
    if (!/\.jar$/i.test(name)) continue;
    try {
      if ((await lstat(join(dir, name))).isFile()) jars.push(name);
    } catch {
      // gone meanwhile
    }
  }
  return jars;
}

const tmpName = (path: string) =>
  `${path}.${randomBytes(4).toString("hex")}.part`;

export function createModLibrary({
  paths,
  logger,
  now = () => new Date(),
}: {
  paths: Paths;
  logger?: Logger;
  now?: () => Date;
}) {
  const file = paths.launcherFile("mods.json");

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function load(): Promise<ModsFile> {
    const data = await readJson(file, fileSchema).catch((err: unknown) => {
      logger?.warn("mods.json is unreadable; starting an empty library", err);
      return undefined;
    });
    return data ?? { schema: 1, mods: {}, links: {} };
  }
  const save = (data: ModsFile) => writeJsonAtomic(file, data);

  /** Metadata (and icon) for a store file. */
  async function describe(sha1: string, fileName: string): Promise<ModMeta> {
    const store = paths.modStoreFile(sha1);
    const info = await readModInfo(store);
    const size = (await stat(store)).size;
    let iconPath: string | undefined;
    if (info.icon) {
      await mkdir(join(paths.modsStoreDir, "icons"), { recursive: true });
      await writeFile(paths.modIcon(sha1), info.icon);
      iconPath = `icons/${sha1}.png`;
    }
    return {
      fileName,
      ...(info.modId && { modId: info.modId }),
      name: info.name || fileName.replace(/\.jar$/i, ""),
      ...(info.version && { version: info.version }),
      loaders: info.loaders,
      ...(info.mcVersionRange && { mcVersionRange: info.mcVersionRange }),
      ...(info.rangeFormat && { rangeFormat: info.rangeFormat }),
      ...(info.depends && { depends: info.depends }),
      ...(info.breaks && { breaks: info.breaks }),
      ...(info.conflicts && { conflicts: info.conflicts }),
      ...(info.provides && { provides: info.provides }),
      ...(info.nested && { nested: info.nested }),
      size,
      infoVersion: INFO_VERSION,
      ...(iconPath && { iconPath }),
      addedAt: now().toISOString(),
    };
  }

  /** Put a jar into the store (copied, then checked), unless it's already there. */
  async function storeCopy(
    source: string,
  ): Promise<{ sha1: string; added: boolean }> {
    const sha1 = await sha1File(source);
    const dest = paths.modStoreFile(sha1);
    if (await exists(dest)) return { sha1, added: false };
    await mkdir(paths.modsStoreDir, { recursive: true });
    const tmp = tmpName(dest);
    try {
      await copyFile(source, tmp);
      if ((await sha1File(tmp)) !== sha1)
        throw new AppError(
          "FILE_CHANGED",
          `${basename(source)} changed while copying.`,
        );
      await rename(tmp, dest);
    } finally {
      await rm(tmp, { force: true });
    }
    return { sha1, added: true };
  }

  async function ensureMeta(data: ModsFile, sha1: string, fileName: string) {
    data.mods[sha1] ??= await describe(sha1, fileName);
  }

  /** The user added this mod themselves: it's never shown as only a dependency. */
  function markUser(data: ModsFile, sha1: string) {
    const meta = data.mods[sha1];
    if (meta) meta.addedAs = "user";
  }

  /** A free file name in a profile's mods folder for this mod. */
  async function freeName(profileId: string, meta: ModMeta, sha1: string) {
    const dir = paths.modsDir(profileId);
    const safe = basename(meta.fileName).replace(/[<>:"/\\|?*]/g, "_");
    const wanted = /\.jar$/i.test(safe) ? safe : `${safe}.jar`;
    if (!(await exists(join(dir, wanted)))) return wanted;
    return wanted.replace(/\.jar$/i, `-${sha1.slice(0, 8)}.jar`);
  }

  /** Remove a profile's file for a mod: only if it's still that mod (never a user's other file). */
  async function unlinkEntry(
    profileId: string,
    fileName: string,
    entry: z.infer<typeof linkSchema>,
  ): Promise<void> {
    const path = join(paths.modsDir(profileId), fileName);
    if (!(await exists(path))) return;
    const store = paths.modStoreFile(entry.sha1);
    const ours =
      (await sameFile(path, store)) ||
      (entry.copied === true && (await sha1File(path)) === entry.sha1);
    if (ours) await unlink(path);
  }

  async function enableIn(
    data: ModsFile,
    profileId: string,
    sha1: string,
    /** Collects the mods this one replaced (same mod id). */
    replaced?: string[],
  ): Promise<"linked" | "copied"> {
    const meta = data.mods[sha1];
    const store = paths.modStoreFile(sha1);
    if (!meta || !(await exists(store)))
      throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
    const links = (data.links[profileId] ??= {});
    const current = Object.entries(links).find(([, e]) => e.sha1 === sha1);
    if (current) {
      if (await exists(join(paths.modsDir(profileId), current[0])))
        return current[1].copied ? "copied" : "linked";
      Reflect.deleteProperty(links, current[0]); // removed by hand since: link it again
    }

    // One version per mod id: enabling this one disables the others.
    if (meta.modId) {
      for (const [name, entry] of Object.entries(links)) {
        if (
          entry.sha1 !== sha1 &&
          data.mods[entry.sha1]?.modId === meta.modId
        ) {
          await unlinkEntry(profileId, name, entry);
          Reflect.deleteProperty(links, name);
          replaced?.push(entry.sha1);
        }
      }
    }

    await mkdir(paths.modsDir(profileId), { recursive: true });
    const name = await freeName(profileId, meta, sha1);
    const mode = await createHardLink(
      store,
      join(paths.modsDir(profileId), name),
    );
    links[name] = { sha1, ...(mode === "copied" && { copied: true }) };
    return mode;
  }

  /** A real jar someone put into `mods/` by hand: store it and keep it enabled. */
  async function adopt(data: ModsFile, profileId: string, fileName: string) {
    const path = join(paths.modsDir(profileId), fileName);
    const sha1 = await sha1File(path);
    const store = paths.modStoreFile(sha1);
    let copied = false;
    if (!(await exists(store))) {
      await mkdir(paths.modsStoreDir, { recursive: true });
      try {
        await link(path, store); // the store and the profile share this very file
      } catch {
        await storeCopy(path);
        copied = true;
      }
    } else {
      // Already stored: make the profile's file a link to the stored one.
      const tmp = tmpName(path);
      const mode = await createHardLink(store, tmp);
      await rename(tmp, path);
      copied = mode === "copied";
    }
    await ensureMeta(data, sha1, fileName);
    markUser(data, sha1);
    (data.links[profileId] ??= {})[fileName] = {
      sha1,
      ...(copied && { copied: true }),
    };
    logger?.info(`adopted ${fileName} into the mod library`);
  }

  async function syncProfile(data: ModsFile, profileId: string) {
    const dir = paths.modsDir(profileId);
    const links = (data.links[profileId] ??= {});
    const files = await jarFiles(dir);
    const present = new Set(files);

    // A file removed by hand means the mod was disabled.
    for (const name of Object.keys(links))
      if (!present.has(name)) Reflect.deleteProperty(links, name);

    const storeIds = new Map<string, string>();
    for (const sha1 of Object.keys(data.mods)) {
      const id = await identity(paths.modStoreFile(sha1));
      if (id) storeIds.set(id, sha1);
    }

    for (const name of files) {
      const path = join(dir, name);
      try {
        const entry = links[name];
        if (entry) {
          const store = paths.modStoreFile(entry.sha1);
          if (!(await exists(store))) {
            // The stored mod is gone: remove its link (if it's still that mod).
            if ((await sha1File(path)) === entry.sha1) {
              await unlink(path);
              Reflect.deleteProperty(links, name);
              continue;
            }
          } else if (await sameFile(path, store)) {
            continue;
          } else if (
            entry.copied &&
            (await stat(path)).size === (await stat(store)).size
          ) {
            continue;
          }
          Reflect.deleteProperty(links, name); // replaced by another file: treat it as new
        }
        const known = storeIds.get((await identity(path)) ?? "");
        if (known) {
          links[name] = { sha1: known };
          continue;
        }
        await adopt(data, profileId, name);
      } catch (err) {
        logger?.warn(`mod sync: ${name} in ${profileId} failed`, err);
      }
    }
  }

  /** Read jars again whose metadata an older launcher wrote; where they came from stays. */
  async function upgradeMeta(data: ModsFile): Promise<void> {
    for (const [sha1, old] of Object.entries(data.mods)) {
      if ((old.infoVersion ?? 1) >= INFO_VERSION) continue;
      if (!(await exists(paths.modStoreFile(sha1)))) continue;
      try {
        const fresh = await describe(sha1, old.fileName);
        data.mods[sha1] = {
          ...fresh,
          addedAt: old.addedAt,
          ...(old.source && { source: old.source }),
          ...(old.sourceCheckedAt && { sourceCheckedAt: old.sourceCheckedAt }),
          ...(old.addedAs && { addedAs: old.addedAs }),
        };
      } catch (err) {
        logger?.warn(`reading ${old.fileName} again failed`, err);
      }
    }
  }

  function usage(data: ModsFile): Map<string, string[]> {
    const users = new Map<string, string[]>();
    for (const [profileId, links] of Object.entries(data.links)) {
      for (const { sha1 } of Object.values(links)) {
        const list = users.get(sha1) ?? [];
        if (!list.includes(profileId)) list.push(profileId);
        users.set(sha1, list);
      }
    }
    return users;
  }

  async function removeFromStore(data: ModsFile, sha1: string) {
    for (const [profileId, links] of Object.entries(data.links)) {
      for (const [name, entry] of Object.entries(links)) {
        if (entry.sha1 !== sha1) continue;
        await unlinkEntry(profileId, name, entry);
        Reflect.deleteProperty(links, name);
      }
    }
    await rm(paths.modStoreFile(sha1), { force: true });
    await rm(paths.modIcon(sha1), { force: true });
    Reflect.deleteProperty(data.mods, sha1);
  }

  return {
    /**
     * Bring the library and profiles' `mods/` in line: adopt jars added by hand,
     * remove links whose stored mod is gone, and record which file is which mod
     * (by file identity, never by name). Profiles with a running game are skipped.
     * Resolves to how many new mods entered the library (adopted from `mods/`).
     */
    sync({ profileIds, only, isRunning }: ModSyncOptions): Promise<number> {
      return serial(async () => {
        const data = await load();
        const before = new Set(Object.keys(data.mods));
        const known = new Set(profileIds);
        for (const id of Object.keys(data.links))
          if (!known.has(id)) Reflect.deleteProperty(data.links, id);
        for (const id of only ?? profileIds) {
          if (known.has(id) && !isRunning(id)) await syncProfile(data, id);
        }
        // Stored files deleted by hand leave nothing behind in the library.
        const users = usage(data);
        for (const sha1 of Object.keys(data.mods)) {
          if (users.has(sha1) || (await exists(paths.modStoreFile(sha1))))
            continue;
          Reflect.deleteProperty(data.mods, sha1);
        }
        await upgradeMeta(data);
        await save(data);
        return Object.keys(data.mods).filter((sha1) => !before.has(sha1))
          .length;
      });
    },

    /** Every library mod; seen from `profile`, with its state and compatibility there. */
    list(
      profile?: Pick<Profile, "id" | "gameVersion" | "loader">,
    ): Promise<LibraryMod[]> {
      return serial(async () => {
        const data = await load();
        const users = usage(data);
        const needed = libraryNeededBy(data.mods);
        const links = profile ? (data.links[profile.id] ?? {}) : {};
        return Object.entries(data.mods)
          .map(([sha1, meta]): LibraryMod => {
            const entry = Object.values(links).find((e) => e.sha1 === sha1);
            const neededBy = needed.get(sha1) ?? [];
            return {
              sha1,
              fileName: meta.fileName,
              ...(meta.modId && { modId: meta.modId }),
              name: meta.name,
              ...(meta.version && { version: meta.version }),
              loaders: meta.loaders,
              ...(meta.mcVersionRange && {
                mcVersionRange: rangeText(meta.mcVersionRange),
              }),
              hasIcon: meta.iconPath !== undefined,
              addedAt: meta.addedAt,
              usedBy: users.get(sha1) ?? [],
              ...(meta.source && {
                source: {
                  sourceId: meta.source.sourceId,
                  projectId: meta.source.projectId,
                  pageUrl: meta.source.pageUrl,
                },
              }),
              checked:
                meta.source !== undefined || meta.sourceCheckedAt !== undefined,
              dependency: isDependencyOnly(meta, neededBy),
              neededBy,
              ...(profile && {
                enabled: entry !== undefined,
                ...(entry?.copied && { copied: true }),
                compat: checkCompat(meta, profile),
              }),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },

    /** Add jars from anywhere (file picker, drag and drop) to the library. */
    add(
      files: readonly string[],
    ): Promise<{ sha1: string; added: boolean; fileName: string }[]> {
      return serial(async () => {
        const data = await load();
        const results = [];
        for (const path of files) {
          const { sha1, added } = await storeCopy(path);
          await ensureMeta(data, sha1, basename(path));
          markUser(data, sha1);
          results.push({ sha1, added, fileName: basename(path) });
        }
        await save(data);
        return results;
      });
    },

    meta(sha1: string): Promise<ModMeta | undefined> {
      return serial(async () => (await load()).mods[sha1]);
    },

    /**
     * Add jars that are already in the store (downloaded straight into it),
     * with where they came from. The jar's own metadata comes first.
     */
    addStored(
      files: readonly {
        sha1: string;
        fileName: string;
        source: ModSourceRef;
        /** Only ever promotes: a mod the user added stays theirs. */
        addedAs?: "user" | "dependency";
      }[],
    ): Promise<void> {
      return serial(async () => {
        const data = await load();
        for (const f of files) {
          if (!(await exists(paths.modStoreFile(f.sha1))))
            throw new AppError(
              "MOD_NOT_FOUND",
              `${f.fileName} isn't in the store.`,
            );
          await ensureMeta(data, f.sha1, f.fileName);
          const meta = data.mods[f.sha1];
          if (meta) {
            meta.source = f.source;
            meta.sourceCheckedAt = now().toISOString();
            if (f.addedAs === "user") meta.addedAs = "user";
            else if (f.addedAs && !meta.addedAs) meta.addedAs = f.addedAs;
          }
        }
        await save(data);
      });
    },

    /** Mods not identified yet: never asked, or asked more than a week ago with no match. */
    pendingIdentification(): Promise<string[]> {
      return serial(async () => {
        const data = await load();
        const cutoff = now().getTime() - RECHECK_AFTER_MS;
        return Object.entries(data.mods)
          .filter(
            ([, m]) =>
              !m.source &&
              (!m.sourceCheckedAt || Date.parse(m.sourceCheckedAt) < cutoff),
          )
          .map(([sha1]) => sha1);
      });
    },

    /** Save what the mod sources said: matches get their source, all get a check time. */
    recordIdentification(
      checked: readonly string[],
      matches: ReadonlyMap<string, ModSourceRef>,
    ): Promise<number> {
      return serial(async () => {
        const data = await load();
        let found = 0;
        for (const sha1 of checked) {
          const meta = data.mods[sha1];
          if (!meta) continue;
          meta.sourceCheckedAt = now().toISOString();
          const source = matches.get(sha1);
          if (source && !meta.source) {
            meta.source = source;
            found++;
          }
        }
        await save(data);
        return found;
      });
    },

    /**
     * A snapshot of the library as one profile sees it, for resolving a download:
     * what can be reused, what's enabled, what's stored.
     */
    view(profile: Pick<Profile, "id" | "gameVersion" | "loader">) {
      return serial(async () => {
        const data = await load();
        const links = Object.values(data.links[profile.id] ?? {});
        const fromProject = (sourceId: string, projectId: string) =>
          Object.entries(data.mods).filter(
            ([, m]) =>
              m.source?.sourceId === sourceId &&
              m.source.projectId === projectId,
          );
        const enabled = (sha1: string) => links.some((l) => l.sha1 === sha1);
        return {
          findUsable(sourceId: string, projectId: string) {
            const candidates = fromProject(sourceId, projectId).filter(
              ([sha1, m]) =>
                enabled(sha1) ||
                checkCompat(m, profile).status !== "incompatible",
            );
            // One already enabled in the profile first.
            const best =
              candidates.find(([sha1]) => enabled(sha1)) ?? candidates[0];
            return best ? { sha1: best[0], name: best[1].name } : undefined;
          },
          enabledFromProject(sourceId: string, projectId: string) {
            return fromProject(sourceId, projectId)
              .filter(([sha1]) => enabled(sha1))
              .map(([sha1, m]) => ({ sha1, name: m.name }));
          },
          hasFile(sha1: string) {
            return data.mods[sha1] !== undefined;
          },
        };
      });
    },

    /** A profile's enabled mods: metadata, and the paths of copies (not hard links). */
    enabledMods(
      profileId: string,
    ): Promise<{ sha1: string; meta: ModMeta; copies: string[] }[]> {
      return serial(async () => {
        const data = await load();
        const bySha1 = new Map<string, string[]>();
        for (const [name, entry] of Object.entries(
          data.links[profileId] ?? {},
        )) {
          const copies = bySha1.get(entry.sha1) ?? [];
          if (entry.copied) copies.push(join(paths.modsDir(profileId), name));
          bySha1.set(entry.sha1, copies);
        }
        return [...bySha1].flatMap(([sha1, copies]) => {
          const meta = data.mods[sha1];
          return meta ? [{ sha1, meta, copies }] : [];
        });
      });
    },

    /** Save that these files' SHA1 was checked and right, at this size and modified time. */
    recordVerified(
      files: readonly { sha1: string; size: number; mtimeMs: number }[],
    ): Promise<void> {
      if (files.length === 0) return Promise.resolve();
      return serial(async () => {
        const data = await load();
        for (const { sha1, size, mtimeMs } of files) {
          const meta = data.mods[sha1];
          if (meta) meta.verified = { size, mtimeMs };
        }
        await save(data);
      });
    },

    /**
     * Put a fresh copy of a damaged mod into the store (`tmpPath` must have the right SHA1),
     * and link it again into every profile that uses it: their hard links still point at
     * the damaged file.
     */
    replaceStored(sha1: string, tmpPath: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        const meta = data.mods[sha1];
        if (!meta)
          throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
        if ((await sha1File(tmpPath)) !== sha1)
          throw new AppError("FILE_CHANGED", `${meta.fileName} didn't match.`);
        const store = paths.modStoreFile(sha1);
        await mkdir(paths.modsStoreDir, { recursive: true });
        await rename(tmpPath, store);
        for (const [profileId, links] of Object.entries(data.links)) {
          for (const [name, entry] of Object.entries(links)) {
            if (entry.sha1 !== sha1) continue;
            const path = join(paths.modsDir(profileId), name);
            const tmp = tmpName(path);
            const mode = await createHardLink(store, tmp);
            await rename(tmp, path);
            links[name] = { sha1, ...(mode === "copied" && { copied: true }) };
          }
        }
        meta.size = (await stat(store)).size;
        delete meta.verified;
        await save(data);
      });
    },

    /**
     * Enable several mods in one step. Resolves to the other mods that were replaced
     * by them (one version per mod id), by name; the batch's own mods are left out.
     */
    enableAll(
      profileId: string,
      sha1s: readonly string[],
    ): Promise<{ sha1: string; name: string }[]> {
      return serial(async () => {
        const data = await load();
        const replaced: string[] = [];
        try {
          for (const sha1 of sha1s)
            await enableIn(data, profileId, sha1, replaced);
        } finally {
          await save(data); // the links made so far are real files: record them
        }
        return [...new Set(replaced)]
          .filter((sha1) => !sha1s.includes(sha1))
          .map((sha1) => ({ sha1, name: data.mods[sha1]?.name ?? sha1 }));
      });
    },

    enable(profileId: string, sha1: string): Promise<"linked" | "copied"> {
      return serial(async () => {
        const data = await load();
        const mode = await enableIn(data, profileId, sha1);
        await save(data);
        return mode;
      });
    },

    /** Remove the profile's link only; the mod stays in the library. */
    disable(profileId: string, sha1: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        const links = data.links[profileId] ?? {};
        for (const [name, entry] of Object.entries(links)) {
          if (entry.sha1 !== sha1) continue;
          await unlinkEntry(profileId, name, entry);
          Reflect.deleteProperty(links, name);
        }
        await save(data);
      });
    },

    /** Profiles that have the mod enabled. */
    usedBy(sha1: string): Promise<string[]> {
      return serial(async () => usage(await load()).get(sha1) ?? []);
    },

    /** Delete a mod from the library and from every profile that uses it. */
    remove(sha1: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        if (!data.mods[sha1])
          throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
        await removeFromStore(data, sha1);
        await save(data);
      });
    },

    /** Delete every mod that no profile uses. Returns how many. */
    removeUnused(): Promise<number> {
      return serial(async () => {
        const data = await load();
        const users = usage(data);
        const unused = Object.keys(data.mods).filter((s) => !users.has(s));
        for (const sha1 of unused) await removeFromStore(data, sha1);
        await save(data);
        return unused.length;
      });
    },

    /** A deleted profile's links are gone with its folder; forget them. */
    forgetProfile(profileId: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        Reflect.deleteProperty(data.links, profileId);
        await save(data);
      });
    },

    async icon(sha1: string): Promise<string | null> {
      try {
        const bytes = await readFile(paths.modIcon(sha1));
        return `data:image/png;base64,${bytes.toString("base64")}`;
      } catch {
        return null;
      }
    },
  };
}

export type ModLibrary = ReturnType<typeof createModLibrary>;
