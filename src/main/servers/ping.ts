import { promises as dns } from "node:dns";
import { connect, isIP, type Socket } from "node:net";
import { z } from "zod";
import type { ServerStatus } from "@shared/launcher";
import type { ServerAddress } from "@shared/serverAddress";
import { cleanText, plainText } from "../core/textComponent";

const DEFAULT_PORT = 25565;
/** A status reply is a few KB (its icon is the big part); anything past this is refused. */
const MAX_REPLY = 256 * 1024;
const MAX_MOTD = 512;

export interface PingOptions {
  /** Per attempt (modern, then the old ping). */
  timeoutMs?: number;
  /** `_minecraft._tcp` SRV lookup; tests pass a fake. */
  resolveSrv?: (name: string) => Promise<{ name: string; port: number }[]>;
}

/**
 * Ask a server for its status, the way the game's server list does: the
 * modern ping (1.7+), then the old one for older servers. Never throws: a server
 * that can't be reached or doesn't answer like Minecraft is `offline`.
 */
export async function pingServer(
  address: ServerAddress,
  { timeoutMs = 5000, resolveSrv = (n) => dns.resolveSrv(n) }: PingOptions = {},
): Promise<ServerStatus> {
  const target = await resolveTarget(address, resolveSrv);
  try {
    return await modernPing(address.host, target, timeoutMs);
  } catch (err) {
    // Only a server that answered (just not with a modern reply) gets the old ping.
    if (!(err instanceof PingError) || !err.connected) return { online: false };
  }
  try {
    return await legacyPing(target, timeoutMs);
  } catch {
    return { online: false };
  }
}

/** Where to connect: the given port, else the domain's SRV record, else 25565. */
async function resolveTarget(
  address: ServerAddress,
  resolveSrv: NonNullable<PingOptions["resolveSrv"]>,
): Promise<{ host: string; port: number }> {
  if (address.port !== undefined || isIP(address.host) !== 0)
    return { host: address.host, port: address.port ?? DEFAULT_PORT };
  try {
    const [record] = await resolveSrv(`_minecraft._tcp.${address.host}`);
    if (record) return { host: record.name, port: record.port };
  } catch {
    // no SRV record: the usual port
  }
  return { host: address.host, port: DEFAULT_PORT };
}

class PingError extends Error {
  constructor(
    message: string,
    /** The connection was made (the server just didn't answer as expected). */
    readonly connected: boolean,
  ) {
    super(message);
  }
}

/**
 * One connection: `start` writes the request, `onData` gets everything received
 * so far and returns the result once it has one. Times out, caps the reply, and
 * always destroys the socket.
 */
function exchange<T>(
  target: { host: string; port: number },
  timeoutMs: number,
  start: (socket: Socket) => void,
  onData: (received: Buffer, socket: Socket) => T | undefined,
  /** What the connection closing early means (e.g. a result already enough). */
  onClose: () => T | undefined = () => undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let connected = false;
    let settled = false;
    let received = Buffer.alloc(0);
    const socket = connect({ host: target.host, port: target.port });
    const finish = (result: { ok: T } | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if ("ok" in result) resolve(result.ok);
      else reject(new PingError(result.error, connected));
    };
    const timer = setTimeout(() => {
      finish({ error: "timed out" });
    }, timeoutMs);
    socket.on("connect", () => {
      connected = true;
      start(socket);
    });
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > MAX_REPLY) {
        finish({ error: "reply too large" });
        return;
      }
      try {
        const result = onData(received, socket);
        if (result !== undefined) finish({ ok: result });
      } catch (err) {
        finish({ error: err instanceof Error ? err.message : "bad reply" });
      }
    });
    socket.on("error", (err) => {
      finish({ error: err.message });
    });
    socket.on("close", () => {
      const result = onClose();
      finish(result === undefined ? { error: "closed" } : { ok: result });
    });
  });
}

// ---- The modern ping: VarInt-framed packets ----

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0; // negative numbers as their 32-bit pattern
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** A VarInt at `at`, or undefined when the buffer ends first. */
function readVarInt(
  buf: Buffer,
  at: number,
): { value: number; next: number } | undefined {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[at + i];
    if (byte === undefined) return undefined;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, next: at + i + 1 };
  }
  throw new Error("bad VarInt");
}

const packet = (id: number, ...fields: Buffer[]) => {
  const body = Buffer.concat([varInt(id), ...fields]);
  return Buffer.concat([varInt(body.length), body]);
};

const mcString = (text: string) => {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([varInt(bytes.length), bytes]);
};

/** The packets received so far: `{ id, data }` for each complete one. */
function packets(buf: Buffer): { id: number; data: Buffer }[] {
  const out: { id: number; data: Buffer }[] = [];
  let at = 0;
  for (;;) {
    const length = readVarInt(buf, at);
    if (!length || length.next + length.value > buf.length) return out;
    const id = readVarInt(buf, length.next);
    if (!id) throw new Error("bad packet");
    out.push({
      id: id.value,
      data: buf.subarray(id.next, length.next + length.value),
    });
    at = length.next + length.value;
  }
}

const statusSchema = z.looseObject({
  version: z.looseObject({ name: z.string() }).optional(),
  players: z.looseObject({ online: z.number(), max: z.number() }).optional(),
  description: z.unknown().optional(),
});

async function modernPing(
  hostName: string,
  target: { host: string; port: number },
  timeoutMs: number,
): Promise<ServerStatus> {
  let sentAt = 0;
  let status:
    Omit<Extract<ServerStatus, { online: true }>, "latencyMs"> | undefined;
  let statusMs = 0;
  return exchange<ServerStatus>(
    target,
    timeoutMs,
    (socket) => {
      sentAt = performance.now();
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      socket.write(
        Buffer.concat([
          // Handshake: any protocol version is fine for a status, -1 by custom.
          packet(0x00, varInt(-1), mcString(hostName), port, varInt(1)),
          packet(0x00), // status request
        ]),
      );
    },
    (received, socket) => {
      const [reply, pong] = packets(received);
      if (!reply) return undefined;
      if (!status) {
        if (reply.id !== 0x00) throw new Error("not a status reply");
        const text = readVarInt(reply.data, 0);
        if (!text) throw new Error("bad status reply");
        const json: unknown = JSON.parse(
          reply.data
            .subarray(text.next, text.next + text.value)
            .toString("utf8"),
        );
        const parsed = statusSchema.parse(json);
        status = {
          online: true,
          version: (parsed.version?.name ?? "").slice(0, 64),
          players: {
            online: Math.max(0, Math.floor(parsed.players?.online ?? 0)),
            max: Math.max(0, Math.floor(parsed.players?.max ?? 0)),
          },
          motd: cleanText(plainText(parsed.description)).slice(0, MAX_MOTD),
        };
        statusMs = performance.now() - sentAt;
        // The ping: the server echoes the number back.
        sentAt = performance.now();
        socket.write(packet(0x01, Buffer.alloc(8)));
      }
      if (pong)
        return { ...status, latencyMs: Math.round(performance.now() - sentAt) };
      return undefined;
    },
    // Some servers close after the status: its round trip is the latency then.
    () => (status ? { ...status, latencyMs: Math.round(statusMs) } : undefined),
  );
}

// ---- The old ping (servers before 1.7) ----

async function legacyPing(
  target: { host: string; port: number },
  timeoutMs: number,
): Promise<ServerStatus> {
  let sentAt = 0;
  return exchange<ServerStatus>(
    target,
    timeoutMs,
    (socket) => {
      sentAt = performance.now();
      socket.write(Buffer.from([0xfe, 0x01]));
    },
    (received) => {
      if (received.length < 3) return undefined;
      if (received[0] !== 0xff) throw new Error("not a legacy reply");
      const length = received.readUInt16BE(1);
      if (received.length < 3 + length * 2) return undefined;
      // UTF-16 big-endian: swap each pair to read it as little-endian.
      const swapped = Buffer.from(received.subarray(3, 3 + length * 2));
      swapped.swap16();
      const text = swapped.toString("utf16le");
      const latencyMs = Math.round(performance.now() - sentAt);
      // 1.4–1.6: §1\0protocol\0version\0motd\0online\0max
      if (text.startsWith("§1\u0000")) {
        const [, , version = "", motd = "", online = "0", max = "0"] =
          text.split("\u0000");
        return {
          online: true,
          version: version.slice(0, 64),
          players: { online: count(online), max: count(max) },
          motd: cleanText(motd).slice(0, MAX_MOTD),
          latencyMs,
        };
      }
      // Older: motd§online§max
      const parts = text.split("§");
      const max = parts.pop() ?? "0";
      const online = parts.pop() ?? "0";
      return {
        online: true,
        version: "",
        players: { online: count(online), max: count(max) },
        motd: cleanText(parts.join("§")).slice(0, MAX_MOTD),
        latencyMs,
      };
    },
  );
}

const count = (text: string) => {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
