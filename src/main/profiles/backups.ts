import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { dirname, join } from "node:path";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { z } from "zod";
import type {
  BackupAuto,
  BackupWhen,
  LauncherSettings,
  WorldBackup,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import { unzipEntries } from "../core/unzip";
import { safeJoin, type Paths } from "../minecraft/paths";
import { uniqueWorldId, WORLD_FLAG, writeOwner } from "./worlds";

/*
 * World backups: one zip per backup in `backups/<key>/`, with an `index.json`
 * listing them. A world that hasn't changed since its newest backup (same files,
 * sizes and modified times) isn't backed up again. Restoring unpacks a backup as a
 * new world; the current one is never overwritten.
 */

/** Left out of backups: Minecraft's lock, and the launcher's owner flag. */
const SKIPPED = new Set(["session.lock", WORLD_FLAG]);

const entrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  worldBytes: z.number(),
  fingerprint: z.string(),
  reason: z.enum(["manual", "auto"]),
});
const indexSchema = z.object({
  schema: z.literal(1),
  /** The world's folder name, for naming a restored copy. */
  folder: z.string(),
  worldName: z.string(),
  entries: z.array(entrySchema),
});
type Index = z.infer<typeof indexSchema>;
type Entry = z.infer<typeof entrySchema>;

/** Where a world's backups are kept: its id, or `<profile>~<folder>` for an unlinked world. */
export function backupKey(
  world: { id: string; linked: boolean },
  profileId: string,
): string {
  if (world.linked) return world.id;
  return `${profileId}~${world.id}`.slice(0, 128).replace(/[. ]+$/, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIndex(
  paths: Paths,
  key: string,
): Promise<Index | undefined> {
  return readJson(paths.backupIndex(key), indexSchema).catch(() => undefined);
}

const toInfo = (e: Entry): WorldBackup => ({
  id: e.id,
  createdAt: e.createdAt,
  sizeBytes: e.sizeBytes,
  worldBytes: e.worldBytes,
  reason: e.reason,
});

interface WorldFile {
  /** Forward slashes, relative to the world folder. */
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/** Every file and folder of a world (no links), and its fingerprint. */
async function walkWorld(root: string) {
  const files: WorldFile[] = [];
  const dirs: string[] = [];
  const visit = async (rel: string) => {
    for (const name of await readdir(rel ? join(root, rel) : root)) {
      if (!rel && SKIPPED.has(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const abs = join(root, ...childRel.split("/"));
      const info = await lstat(abs);
      if (info.isDirectory()) {
        dirs.push(childRel);
        await visit(childRel);
      } else if (info.isFile()) {
        files.push({
          rel: childRel,
          abs,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      }
    }
  };
  await visit("");
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const hash = createHash("sha1");
  for (const f of files)
    hash.update(
      `${f.rel}\t${String(f.size)}\t${String(Math.floor(f.mtimeMs))}\n`,
    );
  return {
    files,
    dirs,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    fingerprint: hash.digest("hex"),
  };
}

/** The same fingerprint `createBackup` records: only names, sizes and modified times. */
export async function worldFingerprint(dir: string): Promise<string> {
  return (await walkWorld(dir)).fingerprint;
}

/** Zip dates must be 1980–2099. */
const zipDate = (ms: number) =>
  Math.min(Math.max(ms, Date.UTC(1980, 0, 2)), Date.UTC(2099, 11, 30));

function checkCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new AppError("CANCELLED", "Backup cancelled.");
}

export interface CreateBackupOptions {
  paths: Paths;
  key: string;
  /** The world folder. */
  sourceDir: string;
  worldName: string;
  reason: WorldBackup["reason"];
  signal?: AbortSignal;
  onProgress?: (p: { bytes: number; totalBytes: number }) => void;
  now?: () => Date;
}

/** Back a world up, unless it's unchanged since its newest backup. */
export async function createBackup({
  paths,
  key,
  sourceDir,
  worldName,
  reason,
  signal,
  onProgress,
  now = () => new Date(),
}: CreateBackupOptions): Promise<
  { backup: WorldBackup } | { unchanged: WorldBackup }
> {
  const world = await walkWorld(sourceDir);
  const index: Index = (await readIndex(paths, key)) ?? {
    schema: 1,
    folder: sourceDir.split(/[\\/]/).pop() ?? key,
    worldName,
    entries: [],
  };
  const newest = [...index.entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  if (newest?.fingerprint === world.fingerprint)
    return { unchanged: toInfo(newest) };

  const createdAt = now();
  let id = createdAt.toISOString().replace(/[:.]/g, "-");
  if (index.entries.some((e) => e.id === id))
    id = `${id}-${randomBytes(2).toString("hex")}`;
  const file = paths.backupFile(key, id);
  const part = `${file}.part`;
  await mkdir(dirname(file), { recursive: true });

  const out = createWriteStream(part);
  let zipError: Error | undefined;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });
  let bytes = 0;
  try {
    for (const d of world.dirs) {
      const entry = new ZipPassThrough(`${d}/`);
      zip.add(entry);
      entry.push(new Uint8Array(0), true);
    }
    for (const f of world.files) {
      checkCancelled(signal);
      const entry = new ZipDeflate(f.rel, { level: 6 });
      entry.mtime = zipDate(f.mtimeMs);
      zip.add(entry);
      for await (const chunk of createReadStream(f.abs, {
        highWaterMark: 256 * 1024,
      })) {
        const data = chunk as Buffer;
        entry.push(data, false);
        bytes += data.length;
        onProgress?.({ bytes, totalBytes: world.totalBytes });
        if (zipError) throw zipError;
        if (out.writableNeedDrain) await once(out, "drain");
        checkCancelled(signal);
      }
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
    if (zipError) throw zipError;
    await finished(out);
    await rename(part, file);
  } catch (err) {
    zip.terminate();
    out.destroy();
    await rm(part, { force: true });
    throw err;
  }

  const entry: Entry = {
    id,
    createdAt: createdAt.toISOString(),
    sizeBytes: (await stat(file)).size,
    worldBytes: world.totalBytes,
    fingerprint: world.fingerprint,
    reason,
  };
  await writeJsonAtomic(paths.backupIndex(key), {
    ...index,
    worldName,
    entries: [...index.entries, entry],
  });
  return { backup: toInfo(entry) };
}

/** A world's backups, newest first. */
export async function listBackups(
  paths: Paths,
  key: string,
): Promise<WorldBackup[]> {
  const index = await readIndex(paths, key);
  return (index?.entries ?? [])
    .map(toInfo)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Every backup folder with its index (for totals and backups of deleted worlds). */
export async function listBackupFolders(
  paths: Paths,
): Promise<{ key: string; worldName: string; backups: WorldBackup[] }[]> {
  let keys: string[];
  try {
    keys = await readdir(paths.backupsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const key of keys) {
    if (key.startsWith(".")) continue; // a restore in progress
    const index = await readIndex(paths, key);
    if (!index) continue;
    out.push({
      key,
      worldName: index.worldName,
      backups: index.entries.map(toInfo),
    });
  }
  return out;
}

export async function deleteBackup(
  paths: Paths,
  key: string,
  id: string,
): Promise<void> {
  const index = await readIndex(paths, key);
  if (!index?.entries.some((e) => e.id === id))
    throw new AppError("BACKUP_NOT_FOUND", "This backup doesn't exist.");
  await writeJsonAtomic(paths.backupIndex(key), {
    ...index,
    entries: index.entries.filter((e) => e.id !== id),
  });
  await rm(paths.backupFile(key, id), { force: true });
}

/** Delete a world's whole backup folder (a world that no longer exists). */
export async function deleteBackupFolder(
  paths: Paths,
  key: string,
): Promise<void> {
  await rm(paths.backupDir(key), { recursive: true, force: true });
}

export interface Retention {
  keepCount: number | null;
  keepDays: number | null;
}

/**
 * Apply the retention settings to a world's backups: at most `keepCount`, none
 * older than `keepDays`. The newest is always kept. Resolves to how many were deleted.
 */
export async function pruneBackups(
  paths: Paths,
  key: string,
  { keepCount, keepDays }: Retention,
  now: () => Date = () => new Date(),
): Promise<number> {
  const index = await readIndex(paths, key);
  if (!index) return 0;
  const sorted = [...index.entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const cutoff =
    keepDays === null ? undefined : now().getTime() - keepDays * 86_400_000;
  const drop = sorted.filter(
    (e, i) =>
      i > 0 &&
      ((keepCount !== null && i >= keepCount) ||
        (cutoff !== undefined && Date.parse(e.createdAt) < cutoff)),
  );
  if (drop.length === 0) return 0;
  const gone = new Set(drop.map((e) => e.id));
  await writeJsonAtomic(paths.backupIndex(key), {
    ...index,
    entries: index.entries.filter((e) => !gone.has(e.id)),
  });
  for (const e of drop) await rm(paths.backupFile(key, e.id), { force: true });
  return drop.length;
}

/** `YYYY-MM-DD` in the computer's time zone (the day the user saw the backup made). */
function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Unpack a zip into `dir`. Every entry must stay inside it. */
async function unzipTo(zipFile: string, dir: string): Promise<void> {
  await unzipEntries(zipFile, {
    code: "BACKUP_DAMAGED",
    target: (name) => {
      try {
        return safeJoin(dir, name);
      } catch {
        throw new AppError("BACKUP_DAMAGED", `Unsafe path in backup: ${name}`);
      }
    },
  });
}

/**
 * Unpack a backup as a new world (`<folder> backup <date>`) owned by `toProfileId`.
 * Resolves to the new world's id; the caller syncs to link it into the profile.
 */
export async function restoreBackup(
  paths: Paths,
  key: string,
  id: string,
  toProfileId: string,
): Promise<string> {
  const index = await readIndex(paths, key);
  const entry = index?.entries.find((e) => e.id === id);
  if (!index || !entry)
    throw new AppError("BACKUP_NOT_FOUND", "This backup doesn't exist.");
  const file = paths.backupFile(key, id);
  if (!(await exists(file)))
    throw new AppError("BACKUP_NOT_FOUND", "The backup file is missing.");

  // Unpacked next to the backups (same drive as worlds/), then moved in whole.
  const tmp = join(
    paths.backupsDir,
    `.restore-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  try {
    await unzipTo(file, tmp);
    if (!(await exists(join(tmp, "level.dat"))))
      throw new AppError("BACKUP_DAMAGED", "The backup has no level.dat.");
    await writeOwner(tmp, toProfileId);
    await mkdir(paths.worldsDir, { recursive: true });
    const worldId = await uniqueWorldId(
      paths,
      `${index.folder} backup ${localDate(entry.createdAt)}`,
    );
    await rename(tmp, paths.worldDir(worldId));
    return worldId;
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

export type BackupMoment = BackupWhen;

/** Should an automatic backup run at this moment (before the start, or after the exit)? */
export function backupDue(
  settings: Pick<
    LauncherSettings,
    "backupAuto" | "backupWhen" | "backupIntervalDays"
  >,
  lastBackupAt: string | undefined,
  moment: BackupMoment,
  now: Date = new Date(),
): boolean {
  const auto: BackupAuto = settings.backupAuto;
  if (auto === "off" || moment !== settings.backupWhen) return false;
  if (auto === "launch") return true;
  if (!lastBackupAt) return true;
  return (
    now.getTime() - Date.parse(lastBackupAt) >=
    settings.backupIntervalDays * 86_400_000
  );
}
