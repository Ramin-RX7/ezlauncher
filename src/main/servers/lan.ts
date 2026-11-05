import { createSocket } from "node:dgram";
import type { LanWorld } from "@shared/launcher";
import type { Logger } from "../core/logger";
import { cleanText } from "../core/textComponent";

/** Where the game announces a world opened to LAN (every 1.5 s). */
export const LAN_GROUP = "224.0.2.60";
export const LAN_PORT = 4445;
/** A world not announced for this long is gone. */
const FORGET_AFTER_MS = 10_000;
const MAX_WORLDS = 50;

/** `[MOTD]name[/MOTD][AD]port[/AD]`, as the game sends it. */
export function parseLanAnnouncement(
  text: string,
): { name: string; port: number } | undefined {
  const name = /\[MOTD\]([\s\S]*?)\[\/MOTD\]/.exec(text)?.[1];
  const ad = /\[AD\](\d{1,5})\[\/AD\]/.exec(text)?.[1];
  if (name === undefined || ad === undefined) return undefined;
  const port = Number(ad);
  if (port < 1 || port > 65535) return undefined;
  return { name: cleanText(name).slice(0, 128), port };
}

/** What the listener needs from a UDP socket (Node's `dgram`, or a fake in tests). */
export interface LanSocket {
  on(
    event: "message",
    listener: (msg: Buffer, rinfo: { address: string }) => void,
  ): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  bind(port: number, callback: () => void): unknown;
  addMembership(group: string): void;
  close(): unknown;
}

/**
 * Listens for worlds opened to LAN while started. A port already taken or a
 * network without multicast just means no worlds are found.
 */
export function createLanListener({
  socket = () => createSocket({ type: "udp4", reuseAddr: true }),
  now = Date.now,
  logger,
}: {
  socket?: () => LanSocket;
  now?: () => number;
  logger?: Logger;
} = {}) {
  let current: LanSocket | undefined;
  const seen = new Map<string, LanWorld & { lastSeen: number }>();

  function stop(): void {
    try {
      current?.close();
    } catch {
      // already closed
    }
    current = undefined;
    seen.clear();
  }

  return {
    start(): void {
      if (current) return;
      const s = socket();
      current = s;
      s.on("message", (msg, rinfo) => {
        const found = parseLanAnnouncement(
          msg.subarray(0, 1024).toString("utf8"),
        );
        if (!found) return;
        const address = `${rinfo.address}:${found.port}`;
        if (!seen.has(address) && seen.size >= MAX_WORLDS) return;
        seen.set(address, { name: found.name, address, lastSeen: now() });
      });
      s.on("error", (err) => {
        logger?.info("listening for LAN worlds failed", err);
        if (current === s) stop();
      });
      s.bind(LAN_PORT, () => {
        try {
          s.addMembership(LAN_GROUP);
        } catch (err) {
          logger?.info("joining the LAN group failed", err);
        }
      });
    },
    stop,
    /** The worlds announced in the last few seconds, by name. */
    list(): LanWorld[] {
      const cutoff = now() - FORGET_AFTER_MS;
      for (const [key, world] of seen)
        if (world.lastSeen < cutoff) seen.delete(key);
      return [...seen.values()]
        .map(({ name, address }) => ({ name, address }))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.address.localeCompare(b.address),
        );
    },
    isListening: (): boolean => current !== undefined,
  };
}

export type LanListener = ReturnType<typeof createLanListener>;
