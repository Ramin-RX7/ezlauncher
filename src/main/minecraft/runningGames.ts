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
  quickPlay: z
    .union([
      z.object({ kind: z.literal("world"), worldId: z.string() }),
      z.object({ kind: z.literal("server"), address: z.string() }),
    ])
    .optional(),
  /** Epoch ms. */
  startedAt: z.number(),
});
export type StoredGame = z.infer<typeof gameSchema>;

const fileSchema = z.object({
  schema: z.literal(1),
  games: z.array(gameSchema),
  /** When the launcher last saw these games running (epoch ms): ends play time of games that closed while it was off. */
  seenAt: z.number().optional(),
});

/** A saved game that ended while the launcher wasn't watching it. */
export interface EndedGame extends StoredGame {
  /** The last time the launcher saw it running (its real end is a bit later). */
  seenAt: number;
}

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
    /** Replace the saved list (writes run one after another); notes now as "last seen". */
    save(games: readonly StoredGame[]): Promise<void> {
      const run = queue.then(() =>
        writeJsonAtomic(file, { schema: 1, games: [...games], seenAt: now() }),
      );
      queue = run.catch(() => undefined);
      return run;
    },

    /**
     * Saved games that are still running, and those that ended meanwhile (with when
     * the launcher last saw them). A game started before the computer last booted is
     * gone, even if another process now has its id.
     */
    async restore(): Promise<{ running: StoredGame[]; ended: EndedGame[] }> {
      const data = await readJson(file, fileSchema).catch(() => undefined);
      if (!data) return { running: [], ended: [] };
      const bootedAt = now() - uptimeMs();
      const running: StoredGame[] = [];
      const ended: EndedGame[] = [];
      for (const g of data.games) {
        if (g.startedAt >= bootedAt && isAlive(g.pid)) running.push(g);
        else if (data.seenAt !== undefined && data.seenAt >= g.startedAt)
          ended.push({ ...g, seenAt: data.seenAt });
      }
      return { running, ended };
    },
  };
}
