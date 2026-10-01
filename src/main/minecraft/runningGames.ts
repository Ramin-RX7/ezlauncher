import { uptime } from "node:os";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";

/*
 * Games started by the launcher keep running after it quits. Their process ids are
 * saved here, so a restarted launcher still knows which profiles are playing and
 * never changes their files (mods, worlds, options.txt) under a running game.
 */

const gameSchema = z.object({
  launchId: z.string(),
  profileId: z.string(),
  accountId: z.string(),
  versionId: z.string(),
  pid: z.number(),
  /** Epoch ms. */
  startedAt: z.number(),
});
export type StoredGame = z.infer<typeof gameSchema>;

const fileSchema = z.object({
  schema: z.literal(1),
  games: z.array(gameSchema),
});

/** Is a process with this id alive? (Signal 0 only checks; EPERM still means it exists.) */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createRunningGamesFile(
  file: string,
  {
    isAlive = processAlive,
    now = Date.now,
    uptimeMs = () => uptime() * 1000,
  }: {
    isAlive?: (pid: number) => boolean;
    now?: () => number;
    uptimeMs?: () => number;
  } = {},
) {
  let queue: Promise<unknown> = Promise.resolve();

  return {
    /** Replace the saved list (writes run one after another). */
    save(games: readonly StoredGame[]): Promise<void> {
      const run = queue.then(() =>
        writeJsonAtomic(file, { schema: 1, games: [...games] }),
      );
      queue = run.catch(() => undefined);
      return run;
    },

    /**
     * Saved games that are still running. A game started before the computer last
     * booted is gone, even if another process now has its id.
     */
    async restore(): Promise<StoredGame[]> {
      const data = await readJson(file, fileSchema).catch(() => undefined);
      if (!data) return [];
      const bootedAt = now() - uptimeMs();
      return data.games.filter(
        (g) => g.startedAt >= bootedAt && isAlive(g.pid),
      );
    },
  };
}
