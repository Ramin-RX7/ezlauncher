import { z } from "zod";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Logger } from "../core/logger";

/*
 * `launcher/playtime.json`: how long each profile was played. Every game that
 * closes adds a session; the total counts all of them, the history keeps the
 * newest. Two games of one profile at once (different accounts) both count.
 */

/** Sessions kept per profile (the total still counts every session). */
export const MAX_SESSIONS = 200;
/** A session longer than this is a stale record, not play time. */
const MAX_SESSION_MS = 48 * 60 * 60 * 1000;

const quickPlaySchema = z.union([
  z.object({ kind: z.literal("world"), worldId: z.string() }),
  z.object({ kind: z.literal("server"), address: z.string() }),
]);

const sessionSchema = z.object({
  startedAt: z.number(),
  endedAt: z.number(),
  accountId: z.string(),
  quickPlay: quickPlaySchema.optional(),
  /** Ended while the launcher was closed: it ends when the launcher last saw it. */
  approx: z.boolean().optional(),
});
export type PlaySession = z.infer<typeof sessionSchema>;

const fileSchema = z.object({
  schema: z.literal(1),
  profiles: z.record(
    z.string(),
    z.object({ totalMs: z.number(), sessions: z.array(sessionSchema) }),
  ),
});
type PlayFile = z.infer<typeof fileSchema>;

export function createPlayTime(
  file: string,
  { logger }: { logger?: Logger } = {},
) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  async function load(): Promise<PlayFile> {
    const data = await readJson(file, fileSchema).catch((err: unknown) => {
      logger?.warn("playtime.json is unreadable; starting empty", err);
      return undefined;
    });
    return data ?? { schema: 1, profiles: {} };
  }

  return {
    /** Add a finished game. Nonsense times (negative, days long) are ignored. */
    record(profileId: string, session: PlaySession): Promise<void> {
      const length = session.endedAt - session.startedAt;
      if (!(length > 0) || length > MAX_SESSION_MS) return Promise.resolve();
      return serial(async () => {
        const data = await load();
        const entry = (data.profiles[profileId] ??= {
          totalMs: 0,
          sessions: [],
        });
        entry.totalMs += length;
        entry.sessions = [session, ...entry.sessions]
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, MAX_SESSIONS);
        await writeJsonAtomic(file, data);
      });
    },

    /** Each profile's total, in ms. */
    totals(): Promise<Map<string, number>> {
      return serial(async () => {
        const data = await load();
        return new Map(
          Object.entries(data.profiles).map(([id, p]) => [id, p.totalMs]),
        );
      });
    },

    /** A profile's total and its sessions, newest first. */
    history(
      profileId: string,
    ): Promise<{ totalMs: number; sessions: PlaySession[] }> {
      return serial(async () => {
        const entry = (await load()).profiles[profileId];
        return entry ?? { totalMs: 0, sessions: [] };
      });
    },

    /** A deleted profile's play time goes with it. */
    forget(profileId: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        if (!(profileId in data.profiles)) return;
        Reflect.deleteProperty(data.profiles, profileId);
        await writeJsonAtomic(file, data);
      });
    },
  };
}

export type PlayTime = ReturnType<typeof createPlayTime>;
