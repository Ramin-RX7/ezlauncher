import type { RunningGame } from "@shared/launcher";
import { AppError } from "../core/errors";

/**
 * What every part of the launcher service checks before touching a profile's
 * files: the games that run or are starting, mod pack updates, a data move, and
 * the queue that runs folder work one operation at a time. No Electron here.
 */
export function createRuntime() {
  /** Running games, by launch id. */
  const running = new Map<string, RunningGame>();
  /** When each running game started (epoch ms); saved with it. */
  const startedAt = new Map<string, number>();
  /** Launches between their checks and the game starting, as `profileId:accountId`. */
  const starting = new Set<string>();
  /** Profiles whose mod pack is being updated: no game starts meanwhile. */
  const packUpdating = new Set<string>();

  let fsQueue: Promise<unknown> = Promise.resolve();
  /** Folder work (worlds, profile folders) runs one operation at a time; a failure doesn't stop the next. */
  function serialFs<T>(fn: () => Promise<T>): Promise<T> {
    const run = fsQueue.then(fn, fn);
    fsQueue = run.catch(() => undefined);
    return run;
  }

  const isRunning = (profileId: string): boolean =>
    [...running.values()].some((g) => g.profileId === profileId);

  /** A game of this profile is running, or one is being started (or its pack is updating). */
  const isBusy = (profileId: string): boolean =>
    isRunning(profileId) ||
    packUpdating.has(profileId) ||
    [...starting].some((key) => key.startsWith(`${profileId}:`));

  /** Refuse changing a profile's files while a game of it runs or is starting. */
  function assertNotRunning(profileId: string): void {
    if (packUpdating.has(profileId))
      throw new AppError("BUSY", "Wait for the mod pack update to finish.");
    if (isBusy(profileId))
      throw new AppError("GAME_RUNNING", "Close the game first.");
  }

  return {
    running,
    startedAt,
    starting,
    packUpdating,
    /** The data folder is being moved: no background work may touch it. */
    moving: false,
    serialFs,
    isRunning,
    isBusy,
    assertNotRunning,
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
