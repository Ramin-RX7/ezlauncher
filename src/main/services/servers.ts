import type { LanWorld, ServerStatus } from "@shared/launcher";
import { formatServerAddress, parseServerAddress } from "@shared/serverAddress";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { createLanListener, type LanListener } from "../servers/lan";
import { pingServer } from "../servers/ping";

/** A server's status is asked again after this long. */
const STATUS_TTL_MS = 30_000;
/** LAN listening stops when nobody asked for this long (the Servers tab was closed). */
const LAN_IDLE_MS = 30_000;
const MAX_CACHED = 200;

export interface ServerServiceDeps {
  ping?: typeof pingServer;
  lan?: () => LanListener;
  now?: () => number;
  logger?: Logger;
}

/** Server status for the Servers tab, and LAN worlds while someone is looking. */
export function createServerService({
  ping = pingServer,
  lan = () => createLanListener(),
  now = Date.now,
  logger,
}: ServerServiceDeps = {}) {
  const statuses = new Map<
    string,
    { at: number; status: Promise<ServerStatus> }
  >();
  let listener: LanListener | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function stopLan(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    listener?.stop();
    listener = undefined;
  }

  return {
    /** What a server says about itself; the same address is asked at most every 30 s. */
    status(address: unknown): Promise<ServerStatus> {
      const parsed =
        typeof address === "string" ? parseServerAddress(address) : null;
      if (!parsed)
        throw new AppError("INVALID_ADDRESS", "That isn't a server address.");
      const key = formatServerAddress(parsed).toLowerCase();
      const cached = statuses.get(key);
      if (cached && now() - cached.at < STATUS_TTL_MS) return cached.status;
      const status = ping(parsed).catch((err: unknown) => {
        logger?.info(`pinging ${key} failed`, err);
        return { online: false } as const;
      });
      statuses.delete(key);
      statuses.set(key, { at: now(), status });
      // Oldest first: drop the least recently asked.
      while (statuses.size > MAX_CACHED) {
        const oldest = statuses.keys().next().value;
        if (oldest === undefined) break;
        statuses.delete(oldest);
      }
      return status;
    },

    /** Worlds opened to LAN; listening starts on the first call and stops when nobody asks. */
    lanWorlds(): LanWorld[] {
      if (!listener) {
        listener = lan();
        listener.start();
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(stopLan, LAN_IDLE_MS);
      idleTimer.unref();
      return listener.list();
    },

    /** The data folder is going away (move, quit): stop listening now. */
    dispose: stopLan,
  };
}

export type ServerService = ReturnType<typeof createServerService>;
