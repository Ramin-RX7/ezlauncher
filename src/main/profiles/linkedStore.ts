import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { sha1File } from "../minecraft/verify";
import { createHardLink, sameFile } from "./links";

/*
 * A content-addressed store whose files are linked into profile folders: every
 * file is stored once as `<storeDir>/<sha1><ext>`, and a profile that uses it has
 * a hard link to it (or a copy where hard links don't work). Which name in which
 * profile is which stored file is kept in a `links` map the caller loads and saves;
 * these helpers only change it. Shared by the mod library and the pack libraries.
 */

export const linkSchema = z.object({
  sha1: z.string(),
  /** A copy, because hard links didn't work on this drive. */
  copied: z.boolean().optional(),
});
export type LinkEntry = z.infer<typeof linkSchema>;
/** File name in one profile's folder → the stored file it is. */
export type ProfileLinks = Record<string, LinkEntry>;
/** profileId → that profile's links. */
export type AllLinks = Record<string, ProfileLinks>;

export interface StoreLayout {
  storeDir: string;
  storeFile: (sha1: string) => string;
  /** The profile folder these files are linked into (e.g. its `mods/`). */
  profileDir: (profileId: string) => string;
  /** The extension of managed files, with the dot (e.g. `.jar`). */
  ext: string;
  /** For log lines ("mod sync: …"). */
  label: string;
  logger?: Logger;
}

/** What reconciling one profile folder changed. */
export interface ReconcileDiff {
  /** Names that are no longer linked: removed by hand, or their stored file was gone. */
  removed: string[];
  /** A linked file renamed by hand (matched by file identity). */
  renamed: { from: string; to: string; sha1: string }[];
  /** Files put into the folder by hand that entered the store. */
  adopted: { name: string; sha1: string }[];
}

export async function exists(path: string): Promise<boolean> {
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

export const tmpName = (path: string) =>
  `${path}.${randomBytes(4).toString("hex")}.part`;

export function createLinkedStore(layout: StoreLayout) {
  const { storeDir, storeFile, profileDir, ext, label, logger } = layout;
  const extPattern = new RegExp(
    `${ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );

  /** Real files (not links or folders) with the managed extension. */
  async function files(dir: string): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const name of names) {
      if (!extPattern.test(name)) continue;
      try {
        if ((await lstat(join(dir, name))).isFile()) found.push(name);
      } catch {
        // gone meanwhile
      }
    }
    return found;
  }

  /**
   * Put a file into the store unless it's already there. The copy is hashed as it's
   * written, so a file that changes while being copied is refused.
   */
  async function storeCopy(
    source: string,
  ): Promise<{ sha1: string; added: boolean }> {
    const sha1 = await sha1File(source);
    const dest = storeFile(sha1);
    if (await exists(dest)) return { sha1, added: false };
    await mkdir(storeDir, { recursive: true });
    const tmp = tmpName(dest);
    try {
      const hash = createHash("sha1");
      await pipeline(
        createReadStream(source),
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk);
            done(null, chunk);
          },
        }),
        createWriteStream(tmp, { flags: "wx" }),
      );
      if (hash.digest("hex") !== sha1)
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

  /** A free file name in a profile's folder for this stored file. */
  async function freeName(profileId: string, fileName: string, sha1: string) {
    const dir = profileDir(profileId);
    const safe = basename(fileName).replace(/[<>:"/\\|?*]/g, "_");
    const wanted = extPattern.test(safe) ? safe : `${safe}${ext}`;
    if (!(await exists(join(dir, wanted)))) return wanted;
    return wanted.replace(extPattern, `-${sha1.slice(0, 8)}${ext}`);
  }

  /** Remove a profile's file: only if it's still that stored file (never a user's other file). */
  async function unlinkIfOurs(
    profileId: string,
    name: string,
    entry: LinkEntry,
  ): Promise<void> {
    const path = join(profileDir(profileId), name);
    if (!(await exists(path))) return;
    const store = storeFile(entry.sha1);
    const ours =
      (await sameFile(path, store)) ||
      (entry.copied === true && (await sha1File(path)) === entry.sha1);
    if (ours) await unlink(path);
  }

  /** Link a stored file into a profile under a free name based on `fileName`. */
  async function linkInto(
    links: ProfileLinks,
    profileId: string,
    sha1: string,
    fileName: string,
  ): Promise<{ name: string; mode: "linked" | "copied" }> {
    await mkdir(profileDir(profileId), { recursive: true });
    const name = await freeName(profileId, fileName, sha1);
    const mode = await createHardLink(
      storeFile(sha1),
      join(profileDir(profileId), name),
    );
    links[name] = { sha1, ...(mode === "copied" && { copied: true }) };
    return { name, mode };
  }

  /** A real file someone put into the profile folder by hand: store it and keep it. */
  async function adopt(
    links: ProfileLinks,
    profileId: string,
    name: string,
    onAdopted: (sha1: string, name: string) => Promise<void>,
  ): Promise<string> {
    const path = join(profileDir(profileId), name);
    const sha1 = await sha1File(path);
    const store = storeFile(sha1);
    let copied = false;
    if (!(await exists(store))) {
      await mkdir(storeDir, { recursive: true });
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
    await onAdopted(sha1, name);
    links[name] = { sha1, ...(copied && { copied: true }) };
    logger?.info(`adopted ${name} into the ${label} library`);
    return sha1;
  }

  /**
   * Bring one profile folder and its links in line, matching files by identity (never
   * by name): drop links whose file is gone, unlink files whose stored file is gone,
   * record renamed links, and adopt new files (`onAdopted` runs before the link is recorded).
   */
  async function reconcile(
    links: ProfileLinks,
    profileId: string,
    storedSha1s: Iterable<string>,
    onAdopted: (sha1: string, name: string) => Promise<void>,
    /** Leave a new file where it is, unstored (e.g. a zip that isn't a pack). */
    shouldAdopt?: (path: string) => Promise<boolean>,
  ): Promise<ReconcileDiff> {
    const dir = profileDir(profileId);
    const names = await files(dir);
    const present = new Set(names);
    const diff: ReconcileDiff = { removed: [], renamed: [], adopted: [] };

    // A file removed by hand means it was turned off (unless it was only renamed).
    const gone = new Map<string, string>();
    for (const [name, entry] of Object.entries(links)) {
      if (present.has(name)) continue;
      gone.set(entry.sha1, name);
      Reflect.deleteProperty(links, name);
    }

    const storeIds = new Map<string, string>();
    for (const sha1 of storedSha1s) {
      const id = await identity(storeFile(sha1));
      if (id) storeIds.set(id, sha1);
    }

    for (const name of names) {
      const path = join(dir, name);
      try {
        const entry = links[name];
        if (entry) {
          const store = storeFile(entry.sha1);
          if (!(await exists(store))) {
            // The stored file is gone: remove its link (if it's still that file).
            if ((await sha1File(path)) === entry.sha1) {
              await unlink(path);
              Reflect.deleteProperty(links, name);
              diff.removed.push(name);
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
          const from = gone.get(known);
          if (from !== undefined) {
            diff.renamed.push({ from, to: name, sha1: known });
            gone.delete(known);
          }
          continue;
        }
        if (shouldAdopt && !(await shouldAdopt(path))) continue;
        const sha1 = await adopt(links, profileId, name, onAdopted);
        diff.adopted.push({ name, sha1 });
      } catch (err) {
        logger?.warn(`${label} sync: ${name} in ${profileId} failed`, err);
      }
    }
    diff.removed.push(...gone.values());
    return diff;
  }

  /** Link a replaced store file again into every profile that uses it. */
  async function relinkAll(all: AllLinks, sha1: string): Promise<void> {
    const store = storeFile(sha1);
    for (const [profileId, links] of Object.entries(all)) {
      for (const [name, entry] of Object.entries(links)) {
        if (entry.sha1 !== sha1) continue;
        const path = join(profileDir(profileId), name);
        const tmp = tmpName(path);
        const mode = await createHardLink(store, tmp);
        await rename(tmp, path);
        links[name] = { sha1, ...(mode === "copied" && { copied: true }) };
      }
    }
  }

  /** sha1 → the profiles that link it. */
  function usage(all: AllLinks): Map<string, string[]> {
    const users = new Map<string, string[]>();
    for (const [profileId, links] of Object.entries(all)) {
      for (const { sha1 } of Object.values(links)) {
        const list = users.get(sha1) ?? [];
        if (!list.includes(profileId)) list.push(profileId);
        users.set(sha1, list);
      }
    }
    return users;
  }

  /** Unlink a stored file from every profile, then delete it from the store. */
  async function removeEverywhere(all: AllLinks, sha1: string): Promise<void> {
    for (const [profileId, links] of Object.entries(all)) {
      for (const [name, entry] of Object.entries(links)) {
        if (entry.sha1 !== sha1) continue;
        await unlinkIfOurs(profileId, name, entry);
        Reflect.deleteProperty(links, name);
      }
    }
    await rm(storeFile(sha1), { force: true });
  }

  return {
    files,
    storeCopy,
    freeName,
    unlinkIfOurs,
    linkInto,
    adopt,
    reconcile,
    relinkAll,
    usage,
    removeEverywhere,
  };
}

export type LinkedStore = ReturnType<typeof createLinkedStore>;
