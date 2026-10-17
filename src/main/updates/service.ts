import { join } from "node:path";
import { z } from "zod";
import type { FeedFile, UpdatePrefs, UpdateState } from "@shared/updates";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import type { FetchFn } from "../minecraft/downloader";
import {
  canReplace,
  downloadPath,
  installUpdate,
  prepareUpdate,
  type ApplyDeps,
} from "./apply";
import type { BuildInfo } from "./buildKind";
import { downloadVerified } from "./download";
import { FEED_URL, parseFeed, pickUpdate } from "./feed";

/*
 * Checking for, downloading and installing launcher updates. App-level (one per
 * app, not per data folder): its file `updates.json` lives in Electron's userData.
 * No Electron imports; index.ts and ipc/updates.ts wire it in.
 */

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 10_000;
const FEED_TIMEOUT_MS = 15_000;

const stateSchema = z.object({
  schema: z.literal(1),
  lastCheckedAt: z.string().optional().catch(undefined),
  autoCheck: z.boolean().optional().catch(true),
});

export interface UpdateServiceDeps {
  fetch: FetchFn;
  version: string;
  build: BuildInfo;
  /** `<userData>/updates.json`. */
  stateFile: string;
  userAgent: string;
  apply: ApplyDeps;
  /** Launcher work that an update must not interrupt (installs, downloads, backups, a data move). */
  isBusy: () => boolean;
  onState: (state: UpdateState) => void;
  logger?: Logger;
  /** Tests and the scratch end-to-end check: another feed, whose files may come from anywhere. */
  feedUrl?: string;
  /** Started after an update that couldn't be finished (the old version came back). */
  updateFailed?: boolean;
  now?: () => number;
}

export function createUpdateService(deps: UpdateServiceDeps) {
  const {
    fetch,
    version,
    build,
    stateFile,
    userAgent,
    isBusy,
    onState,
    logger,
  } = deps;
  const now = deps.now ?? Date.now;
  const feedUrl = deps.feedUrl ?? FEED_URL;
  const allowAnyUrl = deps.feedUrl !== undefined;

  let state: UpdateState = deps.updateFailed
    ? { status: "error", code: "UPDATE_INCOMPLETE" }
    : { status: "idle" };
  let file: FeedFile | undefined;
  let downloaded: string | undefined;
  let controller: AbortController | undefined;
  let checking: Promise<UpdateState> | undefined;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let lastProgress = 0;

  function set(next: UpdateState): void {
    state = next;
    onState(state);
  }

  async function readState() {
    try {
      return (
        (await readJson(stateFile, stateSchema)) ?? {
          schema: 1 as const,
          autoCheck: true,
        }
      );
    } catch (err) {
      logger?.warn("updates.json unreadable; starting fresh", err);
      return { schema: 1 as const, autoCheck: true };
    }
  }

  async function writeState(patch: {
    lastCheckedAt?: string;
    autoCheck?: boolean;
  }) {
    const current = await readState();
    await writeJsonAtomic(stateFile, { ...current, ...patch, schema: 1 });
  }

  /** The last check time, kept in the next state. */
  const keepCheckedAt = (): { checkedAt?: string } =>
    "checkedAt" in state && state.checkedAt
      ? { checkedAt: state.checkedAt }
      : {};

  async function fetchFeed() {
    let res: Response;
    try {
      res = await fetch(feedUrl, {
        headers: { "User-Agent": userAgent, "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AppError("OFFLINE", "Can't reach the update server.", {
        cause: err,
      });
    }
    if (!res.ok)
      throw new AppError(
        "UPDATE_CHECK_FAILED",
        `The update feed answered HTTP ${res.status}.`,
      );
    try {
      return parseFeed(await res.text());
    } catch (err) {
      throw new AppError("UPDATE_CHECK_FAILED", "The update feed is broken.", {
        cause: err,
      });
    }
  }

  async function runCheck(manual: boolean): Promise<UpdateState> {
    // A download or a ready update stays as it is.
    if (
      state.status === "downloading" ||
      state.status === "ready" ||
      state.status === "installing"
    )
      return state;
    const before = state;
    set({
      status: "checking",
      ...keepCheckedAt(),
    });
    try {
      const feed = await fetchFeed();
      const at = new Date(now()).toISOString();
      await writeState({ lastCheckedAt: at }).catch((err: unknown) =>
        logger?.warn("can't save the update check time", err),
      );
      const picked = pickUpdate(feed, version, build.kind, { allowAnyUrl });
      file = picked?.file;
      if (!picked) {
        set({ status: "upToDate", checkedAt: at });
      } else {
        if (!picked.update.blocked && !(await canReplace(build)))
          picked.update.blocked = "notWritable";
        logger?.info(
          `update ${picked.update.version} available${picked.update.blocked ? ` (${picked.update.blocked})` : ""}`,
        );
        set({ status: "available", checkedAt: at, update: picked.update });
      }
    } catch (err) {
      const code = err instanceof AppError ? err.code : "UPDATE_CHECK_FAILED";
      logger?.warn(`update check failed (${code})`, err);
      if (manual) {
        set({
          status: "error",
          code,
          ...keepCheckedAt(),
        });
      } else {
        // A daily check stays quiet (offline is normal); show what was there.
        set(before.status === "checking" ? { status: "idle" } : before);
      }
    }
    return state;
  }

  function check({ manual }: { manual: boolean }): Promise<UpdateState> {
    checking ??= runCheck(manual).finally(() => {
      checking = undefined;
    });
    return checking;
  }

  async function checkIfDue(): Promise<void> {
    const saved = await readState();
    if (saved.autoCheck === false) return;
    const last = saved.lastCheckedAt ? Date.parse(saved.lastCheckedAt) : NaN;
    if (Number.isFinite(last) && now() - last < CHECK_EVERY_MS) {
      if (state.status === "idle" && !state.checkedAt && saved.lastCheckedAt)
        set({ status: "idle", checkedAt: saved.lastCheckedAt });
      return;
    }
    await check({ manual: false });
  }

  async function download(): Promise<void> {
    // After a failed download, "Try again" downloads the same update.
    const retry = state.status === "error" ? state.update : undefined;
    if (state.status !== "available" && !retry)
      throw new AppError("UPDATE_FAILED", "There is no update to download.");
    const update = state.status === "available" ? state.update : retry;
    if (!update)
      throw new AppError("UPDATE_FAILED", "There is no update to download.");
    const at = state.checkedAt ?? new Date(now()).toISOString();
    if (update.blocked || !file)
      throw new AppError(
        update.blocked === "notWritable"
          ? "UPDATE_NOT_WRITABLE"
          : "UPDATE_FAILED",
        "This copy of the app can't update itself.",
      );
    const dest = downloadPath(build, file, deps.apply.tempDir);
    controller = new AbortController();
    const { signal } = controller;
    set({
      status: "downloading",
      checkedAt: at,
      update,
      received: 0,
      total: file.size,
    });
    try {
      await downloadVerified(fetch, file, dest, {
        signal,
        userAgent,
        onProgress: (received, total) => {
          const t = now();
          if (received < total && t - lastProgress < 150) return;
          lastProgress = t;
          set({
            status: "downloading",
            checkedAt: at,
            update,
            received,
            total,
          });
        },
      });
      await prepareUpdate(build, dest, deps.apply, signal);
      downloaded = dest;
      logger?.info(`update ${update.version} downloaded`);
      set({ status: "ready", checkedAt: at, update });
    } catch (err) {
      if (err instanceof AppError && err.code === "CANCELLED") {
        set({ status: "available", checkedAt: at, update });
        return;
      }
      const code = err instanceof AppError ? err.code : "UPDATE_FAILED";
      logger?.error("update download failed", err);
      set({ status: "error", checkedAt: at, code, update });
      throw err instanceof AppError
        ? err
        : new AppError("UPDATE_FAILED", "The update couldn't be downloaded.", {
            cause: err,
          });
    } finally {
      controller = undefined;
    }
  }

  /** Put the downloaded update in place. With `restart` the new version starts; the caller quits next. */
  async function install({ restart }: { restart: boolean }): Promise<void> {
    if (state.status !== "ready" || !downloaded)
      throw new AppError("UPDATE_FAILED", "No update is ready to install.");
    if (isBusy())
      throw new AppError(
        "UPDATE_BUSY",
        "Wait for the launcher's downloads, installs and backups to finish first.",
      );
    const { update, checkedAt: at } = state;
    set({ status: "installing", checkedAt: at, update });
    try {
      await installUpdate(build, downloaded, restart, deps.apply);
      logger?.info(`installing update ${update.version}`);
    } catch (err) {
      logger?.error("update install failed", err);
      set({ status: "error", checkedAt: at, code: "UPDATE_FAILED", update });
      throw new AppError("UPDATE_FAILED", "The update couldn't be installed.", {
        cause: err,
      });
    }
  }

  return {
    getState: (): UpdateState => state,
    async getPrefs(): Promise<UpdatePrefs> {
      return { autoCheck: (await readState()).autoCheck ?? true };
    },
    async setPrefs(prefs: UpdatePrefs): Promise<UpdatePrefs> {
      await writeState({ autoCheck: prefs.autoCheck });
      if (prefs.autoCheck) void checkIfDue();
      return prefs;
    },
    check,
    download,
    cancel(): void {
      controller?.abort();
    },
    install,
    /** On quit: install a ready update without starting it. Never throws. */
    async installOnQuit(): Promise<void> {
      if (state.status !== "ready" || isBusy()) return;
      await install({ restart: false }).catch(() => undefined);
    },
    /** The daily check: soon after start, then whenever a day has passed. */
    start(): void {
      const tick = () =>
        void checkIfDue().catch((err: unknown) =>
          logger?.warn("update check failed", err),
        );
      timers.push(setTimeout(tick, FIRST_CHECK_MS));
      timers.push(setInterval(tick, TICK_MS));
    },
    stop(): void {
      for (const t of timers) clearTimeout(t);
      timers = [];
      controller?.abort();
    },
  };
}

export type UpdateService = ReturnType<typeof createUpdateService>;

export const updateStateFile = (userData: string) =>
  join(userData, "updates.json");
