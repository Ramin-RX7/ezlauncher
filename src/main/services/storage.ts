import { readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CleanupId,
  CleanupPlan,
  CleanupResult,
  StorageReport,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { javaUsage } from "../minecraft/javaRuntimes";
import type { Paths } from "../minecraft/paths";
import type { Platform } from "../minecraft/platform";
import { removeTree } from "../profiles/links";
import {
  createSizeCounter,
  measureDisk,
  STORAGE_CATEGORIES,
} from "../storage/diskUsage";
import {
  neededGameFiles,
  orphanGameFiles,
  type GameFileOrphans,
} from "../storage/gameFiles";

/*
 * The Storage page: how big each part of the data folder is, and clean-ups for
 * what nothing uses. Each clean-up is planned (what goes, how much) before it runs,
 * and planned again right before deleting, so nothing in use is removed.
 */

/** The order clean-ups run in (versions before Java: removing versions frees runtimes). */
export const CLEANUP_ORDER: readonly CleanupId[] = [
  "libraryItems",
  "versions",
  "java",
  "gameFiles",
  "backups",
  "logs",
];
/** Items listed per clean-up (the size counts all of them). */
const MAX_ITEMS = 300;

interface LibraryItem {
  name: string;
  /** Bytes, when known without reading the file. */
  size?: number;
  /** For sizes read from the store. */
  file?: string;
  usedBy: string[];
}

export interface StorageDeps {
  paths: Paths;
  platform: Platform;
  logger: Logger;
  /** The libraries' items and their "remove unused". */
  libraries: {
    list: () => Promise<LibraryItem[]>;
    removeUnused: () => Promise<number>;
  }[];
  installedVersions: () => Promise<
    { id: string; usedBy: string[]; dependents: string[] }[]
  >;
  deleteVersion: (id: string) => Promise<void>;
  removeJava: (component: string) => Promise<void>;
  /** Backup folders of worlds that no longer exist. */
  orphanBackupFolders: () => Promise<string[]>;
  profileIds: () => Promise<string[]>;
  /** A game of the profile runs or starts. */
  isBusy: (profileId: string) => boolean;
  /** Installs, a backup job, a data move: game files can't be cleaned now. */
  busy: () => boolean;
  serialFs: <T>(fn: () => Promise<T>) => Promise<T>;
  progress: (files: number) => void;
}

interface Planned {
  plan: CleanupPlan;
  run: () => Promise<number>;
}

export function createStorageService(deps: StorageDeps) {
  const { paths, logger: log } = deps;

  async function folderBytes(path: string): Promise<number> {
    return (await createSizeCounter().count(path)).bytes;
  }

  async function children(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).map((n) => join(dir, n));
    } catch {
      return [];
    }
  }

  const plan = (
    id: CleanupId,
    items: { label: string; bytes: number }[],
    extra: Partial<CleanupPlan> = {},
  ): CleanupPlan => ({
    id,
    bytes: items.reduce((n, i) => n + i.bytes, 0),
    count: items.length,
    items: [...items].sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ITEMS),
    available: items.length > 0,
    ...extra,
  });

  async function libraryItems(): Promise<Planned> {
    const items: { label: string; bytes: number }[] = [];
    for (const lib of deps.libraries) {
      for (const item of await lib.list()) {
        if (item.usedBy.length > 0) continue;
        let bytes = item.size ?? 0;
        if (item.size === undefined && item.file)
          bytes = await stat(item.file).then(
            (s) => s.size,
            () => 0,
          );
        items.push({ label: item.name, bytes });
      }
    }
    return {
      plan: plan("libraryItems", items),
      run: async () => {
        let removed = 0;
        for (const lib of deps.libraries) removed += await lib.removeUnused();
        return removed;
      },
    };
  }

  async function versions(): Promise<Planned> {
    const all = await deps.installedVersions();
    const used = new Set(
      all.filter((v) => v.usedBy.length > 0).map((v) => v.id),
    );
    // A version no profile plays, that nothing a profile plays builds on.
    const unused = all.filter(
      (v) => !used.has(v.id) && !v.dependents.some((d) => used.has(d)),
    );
    const items = await Promise.all(
      unused.map(async (v) => ({
        label: v.id,
        bytes: await folderBytes(paths.versionDir(v.id)),
      })),
    );
    return {
      plan: plan("versions", items),

      run: async () => {
        let n = 0;
        // Loader installs first, so a base version never loses a dependent mid-way.
        for (const v of [...unused].sort(
          (a, b) => a.dependents.length - b.dependents.length,
        )) {
          try {
            await deps.deleteVersion(v.id);
            n++;
          } catch (err) {
            log.info(`version ${v.id} wasn't removed`, err);
          }
        }
        return n;
      },
    };
  }

  /** Runtimes no installed version names (after a versions clean-up, maybe more). */
  async function java(readable: boolean): Promise<Planned> {
    if (!readable)
      return {
        plan: { ...plan("java", []), reason: "unreadable" },
        run: () => Promise.resolve(0),
      };
    const usage = await javaUsage(paths);
    const unused: string[] = [];
    for (const dir of await children(paths.runtimesDir)) {
      const component = dir.slice(paths.runtimesDir.length + 1);
      if (!usage.has(component)) unused.push(component);
    }
    const items = await Promise.all(
      unused.map(async (c) => ({
        label: c,
        bytes: await folderBytes(paths.runtimeDir(c)),
      })),
    );
    return {
      plan: plan("java", items),
      run: async () => {
        for (const c of unused) await deps.removeJava(c);
        return unused.length;
      },
    };
  }

  async function gameFiles(): Promise<Planned & { readable: boolean }> {
    if (deps.busy())
      return {
        readable: true,
        plan: { ...plan("gameFiles", []), reason: "busy" },
        run: () => Promise.resolve(0),
      };
    const needed = await neededGameFiles(paths, deps.platform);
    if ("unknown" in needed) {
      log.info(`game file clean-up skipped: ${needed.unknown} can't be read`);
      return {
        readable: false,
        plan: { ...plan("gameFiles", []), reason: "unreadable" },
        run: () => Promise.resolve(0),
      };
    }
    const orphans: GameFileOrphans = await orphanGameFiles(paths, needed);
    const rel = (p: string) =>
      p.slice(paths.dataDir.length + 1).replace(/\\/g, "/");
    const items = [
      ...orphans.folders.map((f) => ({
        label: `${rel(f.path)}/`,
        bytes: f.bytes,
      })),
      ...orphans.files.map((f) => ({ label: rel(f.path), bytes: f.bytes })),
    ];
    return {
      readable: true,
      plan: plan("gameFiles", items),
      run: async () => {
        // Checked again: an install may have started since the plan.
        if (deps.busy())
          throw new AppError(
            "STORAGE_BUSY",
            "Wait for the installs to finish.",
          );
        await deps.serialFs(async () => {
          for (const f of orphans.files) await rm(f.path, { force: true });
          for (const d of orphans.folders) await removeTree(d.path);
        });
        return items.length;
      },
    };
  }

  async function backups(): Promise<Planned> {
    const targets: { path: string; label: string }[] = [];
    for (const key of await deps.orphanBackupFolders())
      targets.push({ path: paths.backupDir(key), label: `backups/${key}/` });
    for (const dir of await children(join(paths.dataDir, "modpack-backups")))
      targets.push({
        path: dir,
        label: `modpack-backups/${basename(dir)}/`,
      });
    const notes = join(paths.dataDir, "launcher", "patch-notes");
    targets.push({ path: notes, label: "launcher/patch-notes/" });
    const items = (
      await Promise.all(
        targets.map(async (t) => ({ ...t, bytes: await folderBytes(t.path) })),
      )
    ).filter((t) => t.bytes > 0);
    return {
      plan: plan(
        "backups",
        items.map(({ label, bytes }) => ({ label, bytes })),
      ),
      run: async () => {
        await deps.serialFs(async () => {
          for (const t of items)
            await removeTree(t.path).catch(() => undefined);
        });
        return items.length;
      },
    };
  }

  /** Old game logs and crash reports of profiles that aren't playing. */
  async function logs(): Promise<Planned> {
    const files: { path: string; label: string; bytes: number }[] = [];
    for (const id of await deps.profileIds()) {
      if (deps.isBusy(id)) continue;
      const game = paths.gameDir(id);
      for (const sub of ["logs", "crash-reports"]) {
        for (const p of await children(join(game, sub))) {
          const name = basename(p);

          if (sub === "logs" && name === "latest.log") continue;
          const bytes = await folderBytes(p);
          files.push({ path: p, label: `${sub}/${name}`, bytes });
        }
      }
    }
    return {
      plan: plan(
        "logs",
        files.map(({ label, bytes }) => ({ label, bytes })),
      ),
      run: async () => {
        await deps.serialFs(async () => {
          for (const f of files)
            await removeTree(f.path).catch(() => undefined);
        });
        return files.length;
      },
    };
  }

  async function planAll(
    only?: ReadonlySet<CleanupId>,
  ): Promise<Map<CleanupId, Planned>> {
    const out = new Map<CleanupId, Planned>();
    const want = (id: CleanupId) => !only || only.has(id);
    if (want("libraryItems")) out.set("libraryItems", await libraryItems());
    if (want("versions")) out.set("versions", await versions());
    const files = await gameFiles();
    if (want("gameFiles")) out.set("gameFiles", files);
    if (want("java")) out.set("java", await java(files.readable));
    if (want("backups")) out.set("backups", await backups());
    if (want("logs")) out.set("logs", await logs());
    return out;
  }

  let scanning: Promise<StorageReport> | undefined;

  return {
    /** Sizes by category, and what each clean-up would free. */
    scan(): Promise<StorageReport> {
      scanning ??= (async () => {
        try {
          const usage = await measureDisk(paths, { onProgress: deps.progress });
          const plans = await planAll();
          return {
            totalBytes: usage.totalBytes,
            categories: STORAGE_CATEGORIES.map((id) => ({
              id,
              ...usage.categories[id],
            })),
            cleanups: CLEANUP_ORDER.flatMap((id) => {
              const p = plans.get(id);
              return p ? [p.plan] : [];
            }),
            scannedAt: new Date().toISOString(),
          };
        } finally {
          scanning = undefined;
        }
      })();
      return scanning;
    },

    /** Run some clean-ups, in their order; each is planned again first. */
    async clean(ids: unknown): Promise<CleanupResult> {
      const chosen = new Set(
        (Array.isArray(ids) ? ids : []).filter((x): x is CleanupId =>
          CLEANUP_ORDER.includes(x as CleanupId),
        ),
      );
      const result: CleanupResult = { freedBytes: 0, failed: [] };
      for (const id of CLEANUP_ORDER) {
        if (!chosen.has(id)) continue;
        try {
          // Planned again now (Java after versions: their runtimes may be free now).
          const planned = (await planAll(new Set([id]))).get(id);
          if (!planned || planned.plan.count === 0) continue;
          if (planned.plan.reason)
            throw new AppError("STORAGE_BUSY", "This can't be cleaned now.");
          await planned.run(); // each clean-up takes the folder lock itself where it deletes files
          result.freedBytes += planned.plan.bytes;
          log.info(
            `storage clean-up ${id}: ${planned.plan.count} items, ${planned.plan.bytes} bytes`,
          );
        } catch (err) {
          log.warn(`storage clean-up ${id} failed`, err);
          result.failed.push({
            id,
            code: err instanceof AppError ? err.code : "CLEANUP_FAILED",
          });
        }
      }
      return result;
    },
  };
}

export type StorageService = ReturnType<typeof createStorageService>;
