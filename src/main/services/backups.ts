import { mkdir } from "node:fs/promises";
import type {
  BackupProgress,
  BackupResult,
  BackupStateEvent,
  BackupSummary,
  Profile,
  WorldBackup,
  WorldInfo,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { Paths } from "../minecraft/paths";
import {
  backupDue,
  backupKey,
  createBackup,
  deleteBackup,
  deleteBackupFolder,
  listBackupFolders,
  listBackups,
  pruneBackups,
  restoreBackup,
  type BackupMoment,
} from "../profiles/backups";
import { exists } from "../profiles/linkedStore";
import { listWorlds } from "../profiles/worlds";
import type { createSettingsStore } from "../settings/settings";
import type { Runtime } from "./runtime";

export interface BackupServiceDeps {
  paths: Paths;
  settings: Pick<ReturnType<typeof createSettingsStore>, "load">;
  runtime: Runtime;
  /** Resolves once startup (migration, first sync) is done. */
  whenReady: () => Promise<void>;
  requireProfile: (id: string) => Promise<Profile>;
  /** World, mod and pack sync for some (default: all) profiles. */
  sync: (only?: string[]) => Promise<void>;
  changed: () => void;
  openFolder: (dir: string) => Promise<void>;
  showItemInFolder: (file: string) => void;
  state: (e: BackupStateEvent) => void;
  progress: (p: BackupProgress) => void;
  logger: Logger;
}

/** World backups: one job at a time, progress on `backup:progress`. */
export function createBackupService(deps: BackupServiceDeps) {
  const { paths, settings, runtime, requireProfile, changed } = deps;
  const { serialFs, assertNotRunning } = runtime;
  const log = deps.logger;

  let backupQueue: Promise<unknown> = Promise.resolve();
  let backupJob: { controller: AbortController } | undefined;
  let backupsWaiting = 0;

  /** A profile's worlds, with when each was last backed up. */
  async function worldsWithBackups(profileId: string): Promise<WorldInfo[]> {
    const worlds = await listWorlds(paths, profileId);
    return Promise.all(
      worlds.map(async (w) => {
        const backups = await listBackups(paths, backupKey(w, profileId));
        return {
          ...w,
          backupCount: backups.length,
          ...(backups[0] && { lastBackupAt: backups[0].createdAt }),
        };
      }),
    );
  }

  async function findWorld(profileId: string, worldId: string) {
    const world = (await listWorlds(paths, profileId)).find(
      (w) => w.id === worldId,
    );
    if (!world) throw new AppError("WORLD_NOT_FOUND", "World not found.");
    return { world, key: backupKey(world, profileId) };
  }

  async function doBackups(
    profileId: string,
    worldIds: readonly string[] | undefined,
    reason: WorldBackup["reason"],
    beforeStart: boolean,
  ): Promise<BackupResult> {
    const worlds = (await listWorlds(paths, profileId)).filter(
      (w) => !worldIds || worldIds.includes(w.id),
    );
    const result: BackupResult = { created: [], unchanged: [], failed: [] };
    if (worlds.length === 0) return result;
    const retention = await settings.load();
    const controller = new AbortController();
    backupJob = { controller };
    deps.state({ status: "running", profileId, beforeStart });
    try {
      for (const [i, w] of worlds.entries()) {
        if (controller.signal.aborted) break;
        const key = backupKey(w, profileId);
        let sent = 0;
        const report = (bytes: number, totalBytes: number) => {
          deps.progress({
            profileId,
            worldId: w.id,
            worldName: w.name,
            index: i + 1,
            total: worlds.length,
            bytes,
            totalBytes,
            beforeStart,
          });
        };
        report(0, 0);
        try {
          const made = await createBackup({
            paths,
            key,
            sourceDir: w.linked
              ? paths.worldDir(w.id)
              : paths.saveLink(profileId, w.id),
            worldName: w.name,
            reason,
            signal: controller.signal,
            onProgress: ({ bytes, totalBytes }) => {
              // At most ~10 updates a second.
              if (Date.now() - sent < 100 && bytes < totalBytes) return;
              sent = Date.now();
              report(bytes, totalBytes);
            },
          });
          if ("backup" in made) result.created.push(w.name);
          else result.unchanged.push(w.name);
          await pruneBackups(paths, key, {
            keepCount: retention.backupKeepCount,
            keepDays: retention.backupKeepDays,
          });
        } catch (err) {
          if (err instanceof AppError && err.code === "CANCELLED") break;
          log.warn(`backing up world ${w.id} of ${profileId} failed`, err);
          result.failed.push({
            name: w.name,
            code: err instanceof AppError ? err.code : "BACKUP_FAILED",
          });
        }
      }
      deps.state({
        status: controller.signal.aborted
          ? "cancelled"
          : result.failed.length > 0
            ? "failed"
            : "done",
        profileId,
        beforeStart,
      });
      return result;
    } finally {
      backupJob = undefined;
      changed();
    }
  }

  /** Queue a backup job; jobs run one after another. */
  function runBackups(
    profileId: string,
    worldIds: readonly string[] | undefined,
    reason: WorldBackup["reason"],
    beforeStart = false,
  ): Promise<BackupResult> {
    backupsWaiting++;
    const run = backupQueue.then(() =>
      doBackups(profileId, worldIds, reason, beforeStart),
    );
    backupQueue = run.catch(() => undefined);
    return run.finally(() => {
      backupsWaiting--;
    });
  }

  /** Backups of worlds that no longer exist (deleted in game, or with their profile). */
  async function isOrphanBackup(key: string): Promise<boolean> {
    const at = key.indexOf("~");
    if (at < 0) return !(await exists(paths.worldDir(key)));
    try {
      return !(await exists(
        paths.saveLink(key.slice(0, at), key.slice(at + 1)),
      ));
    } catch {
      return true;
    }
  }

  return {
    worldsWithBackups,
    isOrphanBackup,

    /** A backup job is running. */
    hasJob: (): boolean => backupJob !== undefined,
    /** A backup job is running or waiting for its turn. */
    isBusy: (): boolean => backupJob !== undefined || backupsWaiting > 0,

    /** The automatic backup for this moment, if the settings ask for one (changed worlds only). */
    async autoBackup(
      profileId: string,
      moment: BackupMoment,
    ): Promise<BackupResult | undefined> {
      const current = await settings.load();
      if (current.backupAuto === "off" || current.backupWhen !== moment)
        return undefined;
      const due = (await worldsWithBackups(profileId)).filter((w) =>
        backupDue(current, w.lastBackupAt, moment),
      );
      if (due.length === 0) return undefined;
      return runBackups(
        profileId,
        due.map((w) => w.id),
        "auto",
        moment === "beforeStart",
      );
    },

    /** Apply the retention settings to every world's backups (the days limit moves with time). */
    async pruneAll(): Promise<void> {
      const current = await settings.load();
      for (const folder of await listBackupFolders(paths)) {
        await pruneBackups(paths, folder.key, {
          keepCount: current.backupKeepCount,
          keepDays: current.backupKeepDays,
        }).catch((err: unknown) => {
          log.warn(`pruning backups of ${folder.key} failed`, err);
        });
      }
    },

    api: {
      /** Back up some (default: all) of a profile's worlds; unchanged ones are skipped. */
      async backupWorlds(
        profileId: string,
        worldIds?: string[],
      ): Promise<BackupResult> {
        await requireProfile(profileId);
        // The game writes its worlds while it runs: a backup now could be half-saved.
        assertNotRunning(profileId);
        if (runtime.moving)
          throw new AppError("BUSY", "The data folder is being moved.");
        const ids = Array.isArray(worldIds)
          ? worldIds.filter((id): id is string => typeof id === "string")
          : undefined;
        return runBackups(profileId, ids, "manual");
      },

      cancelBackup(): void {
        backupJob?.controller.abort();
      },

      async listWorldBackups(
        profileId: string,
        worldId: string,
      ): Promise<WorldBackup[]> {
        await requireProfile(profileId);
        const { key } = await findWorld(profileId, worldId);
        return listBackups(paths, key);
      },

      /** Unpack a backup as a new world of the same profile. Resolves to its id. */
      async restoreWorldBackup(
        profileId: string,
        worldId: string,
        backupId: string,
      ): Promise<string> {
        await requireProfile(profileId);
        assertNotRunning(profileId);
        const { key } = await findWorld(profileId, worldId);
        const newId = await serialFs(() =>
          restoreBackup(paths, key, backupId, profileId),
        );
        await deps.sync([profileId]);
        changed();
        return newId;
      },

      async deleteWorldBackup(
        profileId: string,
        worldId: string,
        backupId: string,
      ): Promise<void> {
        await requireProfile(profileId);
        const { key } = await findWorld(profileId, worldId);
        await deleteBackup(paths, key, backupId);
        changed();
      },

      async revealWorldBackup(
        profileId: string,
        worldId: string,
        backupId: string,
      ): Promise<void> {
        await requireProfile(profileId);
        const { key } = await findWorld(profileId, worldId);
        const file = paths.backupFile(key, backupId);
        if (!(await exists(file)))
          throw new AppError("BACKUP_NOT_FOUND", "The backup file is missing.");
        deps.showItemInFolder(file);
      },

      async backupSummary(): Promise<BackupSummary> {
        await deps.whenReady();
        const summary: BackupSummary = {
          count: 0,
          totalBytes: 0,
          orphans: { worlds: 0, count: 0, totalBytes: 0 },
        };
        for (const folder of await listBackupFolders(paths)) {
          const bytes = folder.backups.reduce((n, b) => n + b.sizeBytes, 0);
          summary.count += folder.backups.length;
          summary.totalBytes += bytes;
          if (folder.backups.length > 0 && (await isOrphanBackup(folder.key))) {
            summary.orphans.worlds++;
            summary.orphans.count += folder.backups.length;
            summary.orphans.totalBytes += bytes;
          }
        }
        return summary;
      },

      /** Delete the backups of worlds that no longer exist. */
      async deleteOrphanBackups(): Promise<number> {
        await deps.whenReady();
        let removed = 0;
        for (const folder of await listBackupFolders(paths)) {
          if (!(await isOrphanBackup(folder.key))) continue;
          await deleteBackupFolder(paths, folder.key);
          removed += folder.backups.length;
        }
        return removed;
      },

      async openBackupsFolder(): Promise<void> {
        await mkdir(paths.backupsDir, { recursive: true });
        await deps.openFolder(paths.backupsDir);
      },
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
