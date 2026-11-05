import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pingServer } from "./ping";

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => {
            resolve();
          });
        }),
    ),
  );
});

/** A server on a free local port; `handle` gets each connection. */
async function serve(handle: (socket: Socket) => void): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => undefined); // the client hangs up as it likes
    handle(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

const varInt = (value: number) => {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
};
const packet = (id: number, ...fields: Buffer[]) => {
  const body = Buffer.concat([varInt(id), ...fields]);
  return Buffer.concat([varInt(body.length), body]);
};
const mcString = (text: string) => {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([varInt(bytes.length), bytes]);
};

const STATUS = {
  version: { name: "Paper 1.21.4", protocol: 769 },
  players: { online: 12, max: 100 },
  description: {
    text: "§aWelcome ",
    extra: [{ text: "§lto the server" }, "!"],
  },
};

/** Answers a status request, and a ping with its pong unless told not to. */
const modernServer =
  (seen: { handshake?: Buffer }, { pong = true } = {}) =>
  (socket: Socket) => {
    let got = Buffer.alloc(0);
    let answered = false;
    socket.on("data", (chunk: Buffer) => {
      got = Buffer.concat([got, chunk]);
      seen.handshake ??= got;
      if (!answered && got.length > 3) {
        answered = true;
        socket.write(packet(0x00, mcString(JSON.stringify(STATUS))));
        if (!pong) socket.end();
        return;
      }
      // The ping (id 1, 8 bytes) comes back unchanged.
      if (pong && got.includes(Buffer.from([0x09, 0x01])))
        socket.write(packet(0x01, Buffer.alloc(8)));
    });
  };

describe("pingServer", () => {
  it("reads a modern server's status and measures the latency", async () => {
    const seen: { handshake?: Buffer } = {};
    const port = await serve(modernServer(seen));
    const status = await pingServer({ host: "127.0.0.1", port });
    expect(status).toEqual({
      online: true,
      version: "Paper 1.21.4",
      players: { online: 12, max: 100 },
      motd: "Welcome to the server!",
      latencyMs: expect.any(Number) as unknown,
    });
    // The handshake names the host as typed.
    expect(seen.handshake?.includes(Buffer.from("127.0.0.1"))).toBe(true);
  });

  it("still counts a server that closes without answering the ping", async () => {
    const port = await serve(modernServer({}, { pong: false }));
    expect(await pingServer({ host: "127.0.0.1", port })).toMatchObject({
      online: true,
      players: { online: 12, max: 100 },
    });
  });

  it("falls back to the old ping for servers before 1.7", async () => {
    const port = await serve((socket) => {
      socket.on("data", (chunk: Buffer) => {
        if (chunk[0] !== 0xfe) {
          socket.destroy(); // a modern request means nothing to it
          return;
        }
        const text = "§1\u0000127\u00001.6.4\u0000An old server\u00005\u000020";
        const body = Buffer.from(text, "utf16le");
        body.swap16(); // big-endian on the wire
        const head = Buffer.alloc(3);
        head[0] = 0xff;
        head.writeUInt16BE(text.length, 1);
        socket.end(Buffer.concat([head, body]));
      });
    });
    expect(await pingServer({ host: "127.0.0.1", port })).toMatchObject({
      online: true,
      version: "1.6.4",
      players: { online: 5, max: 20 },
      motd: "An old server",
    });
  });

  it("is offline when nothing listens, nothing answers, or the reply is too big", async () => {
    const closed = await serve(() => undefined);
    await new Promise<void>((resolve) => {
      servers.pop()?.close(() => {
        resolve();
      });
    });
    expect(await pingServer({ host: "127.0.0.1", port: closed })).toEqual({
      online: false,
    });

    const silent = await serve(() => undefined);
    expect(
      await pingServer({ host: "127.0.0.1", port: silent }, { timeoutMs: 200 }),
    ).toEqual({ online: false });

    const flood = await serve((socket) => {
      socket.write(Buffer.concat([varInt(10_000_000), Buffer.alloc(300_000)]));
    });
    expect(
      await pingServer({ host: "127.0.0.1", port: flood }, { timeoutMs: 1000 }),
    ).toEqual({ online: false });
  });

  it("follows the domain's SRV record only when no port is given", async () => {
    const port = await serve(modernServer({}));
    const resolveSrv = vi.fn(() =>
      Promise.resolve([{ name: "127.0.0.1", port }]),
    );
    expect(
      await pingServer({ host: "play.example" }, { resolveSrv }),
    ).toMatchObject({ online: true });
    expect(resolveSrv).toHaveBeenCalledWith("_minecraft._tcp.play.example");

    resolveSrv.mockClear();
    await pingServer({ host: "127.0.0.1", port }, { resolveSrv });
    await pingServer({ host: "127.0.0.1" }, { resolveSrv, timeoutMs: 200 });
    expect(resolveSrv).not.toHaveBeenCalled();
  });
});
