import { randomBytes } from "node:crypto";
import {
  chmod,
  cp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FeedFile } from "@shared/updates";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { unzipEntries } from "../core/unzip";
import { safeJoin } from "../minecraft/paths";
import type { BuildInfo } from "./buildKind";
import {
  UPDATED_FLAG,
  UPDATE_FINISH_FLAG,
  NO_RESTART_FLAG,
  UPDATE_FAILED_FLAG,
  UPDATE_FROM_FLAG,
} from "./startupFlags";

/*
 * Putting a downloaded update in place, per kind of build. Every step that can
 * fail happens before the old app is touched, and a swap that fails half-way is
 * undone, so the user always keeps a working launcher.
 *
 * - portableExe: the new exe is downloaded next to the old one as `.update`.
 *   The portable exe holds its own file open while it runs (it can't even be
 *   renamed), so the new exe is started as a helper: once the old one has quit it
 *   moves it aside and copies itself into its place, under the user's file name
 *   (shortcuts keep working), then starts it (`finishUpdate`).
 * - portableZip: the zip is unpacked next to the app folder as `<folder>.new`; the
 *   new version, started from there, does the same with the folders.
 * - installer: the setup runs silently (`/S --updated`, as electron-updater does).
 * - appImage: the new AppImage is renamed over the old one.
 */

export interface ApplyDeps {
  /** Start a program that outlives this one. */
  spawnDetached: (command: string, args: string[]) => void;
  /** This process. */
  pid: number;
  /** For the installer and the zip download. */
  tempDir: string;
  /** The running exe's file name (the zip build's exe has the same name). */
  exeName: string;
  logger?: Logger;
}

/** Where the update's file is downloaded. Next to the target when it's renamed into place. */
export function downloadPath(
  build: BuildInfo,
  file: FeedFile,
  tempDir: string,
): string {
  if (
    (build.kind === "portableExe" || build.kind === "appImage") &&
    build.target
  )
    return `${build.target}.update`;
  return join(tempDir, basename(file.name));
}

/**
 * Electron's `fs` reads `.asar` files as folders, so copying or deleting the
 * app's own folder (`resources/app.asar`) fails. Run `fn` with that turned off.
 */
async function asPlainFiles<T>(fn: () => Promise<T>): Promise<T> {
  const p = process as { noAsar?: boolean };
  const before = p.noAsar;
  p.noAsar = true;
  try {
    return await fn();
  } finally {
    p.noAsar = before;
  }
}

export const oldPath = (target: string) => `${target}.old`;
export const newPath = (target: string) => `${target}.new`;

/** Can this build replace its files? (A read-only USB stick, or Program Files for a portable copy.) */
export async function canReplace(build: BuildInfo): Promise<boolean> {
  if (build.kind === "installer") return true;
  if (!build.target) return false;
  const probe = join(
    dirname(build.target),
    `.ezl-write-test-${randomBytes(4).toString("hex")}`,
  );
  try {
    await writeFile(probe, "");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Retry a rename while Windows still holds the files (a closing app, antivirus). */
async function renameRetrying(
  from: string,
  to: string,
  timeoutMs: number,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retry = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retry || Date.now() > until) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** The folder in an unpacked zip that holds the exe: the root, or its only folder. */
async function appRoot(dir: string, exeName: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === exeName)) return dir;
  const [only] = entries;
  if (only?.isDirectory() && entries.length === 1) {
    const inner = join(dir, only.name);
    if (
      (await readdir(inner, { withFileTypes: true })).some(
        (e) => e.isFile() && e.name === exeName,
      )
    )
      return inner;
  }
  throw new AppError("UPDATE_DAMAGED", `The update has no ${exeName}.`);
}

/**
 * Get a downloaded update ready to install, so installing (maybe while the app
 * quits) only renames or starts something. For the zip build this unpacks it.
 */
export async function prepareUpdate(
  build: BuildInfo,
  downloaded: string,
  deps: Pick<ApplyDeps, "exeName">,
  signal?: AbortSignal,
): Promise<void> {
  return asPlainFiles(async () => {
    if (build.kind !== "portableZip" || !build.target) return;
    const unpacked = `${newPath(build.target)}.unpacking`;
    await rm(unpacked, { recursive: true, force: true });
    await rm(newPath(build.target), { recursive: true, force: true });
    try {
      await unzipEntries(downloaded, {
        target: (name) => {
          try {
            return safeJoin(unpacked, name);
          } catch {
            throw new AppError(
              "UPDATE_DAMAGED",
              `Unsafe path in the update: ${name}`,
            );
          }
        },
        code: "UPDATE_DAMAGED",
        maxBytes: 4 * 1024 ** 3,
        maxFiles: 50_000,
        ...(signal && { signal }),
      });
      const root = await appRoot(unpacked, deps.exeName);
      await rename(root, newPath(build.target));
    } finally {
      await rm(unpacked, { recursive: true, force: true });
      await rm(downloaded, { force: true });
    }
  });
}

/**
 * Put the prepared update in place. With `restart`, the new version starts
 * (once this process has exited); the caller quits right after.
 */
export async function installUpdate(
  build: BuildInfo,
  downloaded: string,
  restart: boolean,
  deps: ApplyDeps,
): Promise<void> {
  return asPlainFiles(async () => {
    const target = build.target;
    const relaunch = [`${UPDATED_FLAG}${deps.pid}`];
    switch (build.kind) {
      case "portableExe": {
        if (!target) break;
        await stat(downloaded);
        deps.spawnDetached(downloaded, [
          `${UPDATE_FINISH_FLAG}${target}`,
          `${UPDATE_FROM_FLAG}${downloaded}`,
          ...relaunch,
          ...(restart ? [] : [NO_RESTART_FLAG]),
        ]);
        return;
      }
      case "appImage": {
        if (!target) break;
        await chmod(downloaded, 0o755);
        await rename(downloaded, target);
        if (restart) deps.spawnDetached(target, relaunch);
        return;
      }
      case "portableZip": {
        if (!target) break;
        const exe = join(newPath(target), deps.exeName);
        await stat(exe);
        deps.spawnDetached(exe, [
          `${UPDATE_FINISH_FLAG}${target}`,
          ...relaunch,
          ...(restart ? [] : [NO_RESTART_FLAG]),
        ]);
        return;
      }
      case "installer":
        deps.spawnDetached(downloaded, [
          "/S",
          "--updated",
          ...(restart ? ["--force-run"] : []),
        ]);
        return;
    }
    throw new AppError(
      "UPDATE_FAILED",
      "This copy of the app can't update itself.",
    );
  });
}

/** Resolves once `pid` has exited, or after `timeoutMs`. */
export async function waitForExit(
  pid: number,
  timeoutMs: number,
  isAlive: (pid: number) => boolean = processAlive,
): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return true;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface FinishOptions {
  /** What's being replaced: the zip build's app folder, or the portable exe. */
  target: string;
  /** The new version: `<folder>.new` (default), or the downloaded `<exe>.update`. */
  source?: string;
  /** The old app, which must have exited first. */
  waitPid?: number;
  restart: boolean;
  deps: ApplyDeps;
  /** How long to wait for the old app's files to be let go. */
  timeoutMs?: number;
  /** Tests: copy the new version (to make it fail). */
  copy?: (from: string, to: string) => Promise<void>;
}

/**
 * Run by the new version (from `<folder>.new` or `<exe>.update`): move the old
 * version aside, copy the new one into its place and start it. On failure the old
 * one is put back and started, told the update failed. Resolves to whether the
 * update went in.
 */
export async function finishUpdate({
  target,
  source = newPath(target),
  waitPid,
  restart,
  deps,
  timeoutMs = 60_000,
  copy = (from, to) => cp(from, to, { recursive: true, errorOnExist: true }),
}: FinishOptions): Promise<boolean> {
  return asPlainFiles(async () => {
    const log = deps.logger;
    if (waitPid !== undefined) await waitForExit(waitPid, timeoutMs);
    const old = oldPath(target);
    const isFolder = (await stat(source)).isDirectory();
    const exe = isFolder ? join(target, deps.exeName) : target;
    try {
      await rm(old, { recursive: true, force: true });
      // Retried: Windows lets go of the old app's files a moment after it exits.
      await renameRetrying(target, old, timeoutMs);
    } catch (err) {
      log?.error("update: can't move the old version aside", err);
      deps.spawnDetached(exe, [UPDATE_FAILED_FLAG]);
      return false;
    }
    try {
      await copy(source, target);
    } catch (err) {
      log?.error(
        "update: copying the new version failed; putting the old one back",
        err,
      );
      try {
        await rm(target, { recursive: true, force: true });
        await renameRetrying(old, target, timeoutMs);
        deps.spawnDetached(exe, [UPDATE_FAILED_FLAG]);
      } catch (restoreErr) {
        log?.error("update: putting the old version back failed", restoreErr);
      }
      return false;
    }
    log?.info(`update: ${target} replaced`);
    if (restart) deps.spawnDetached(exe, [`${UPDATED_FLAG}${deps.pid}`]);
    return true;
  });
}

/** What an update leaves next to the app; removed on every normal start. */
export async function cleanupAfterUpdate(
  build: BuildInfo,
  tempDir: string,
  logger?: Logger,
  retries = 30,
): Promise<void> {
  return asPlainFiles(async () => {
    const leftovers: string[] = [tempDir];
    if (build.target) {
      if (build.kind === "portableExe" || build.kind === "appImage")
        leftovers.push(oldPath(build.target), `${build.target}.update`);
      if (build.kind === "portableZip")
        leftovers.push(
          oldPath(build.target),
          newPath(build.target),
          `${newPath(build.target)}.unpacking`,
        );
    }
    // The helper that installed this version may still hold its own file for a
    // few seconds after it exits: retry for a while.
    for (const path of leftovers) {
      for (let attempt = 0; ; attempt++) {
        try {
          await rm(path, { recursive: true, force: true });
          break;
        } catch (err) {
          if (attempt >= retries) {
            logger?.warn(`update: can't remove ${path} yet`, err);
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  });
}
