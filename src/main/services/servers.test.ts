import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerStatus } from "@shared/launcher";
import type { LanListener } from "../servers/lan";
import { createServerService } from "./servers";

afterEach(() => {
  vi.useRealTimers();
});

const ONLINE: ServerStatus = {
  online: true,
  version: "1.21.4",
  players: { online: 1, max: 20 },
  motd: "Hi",
  latencyMs: 30,
};

function fakeLan() {
  const start = vi.fn();
  const stop = vi.fn();
  const lan = {
    start,
    stop,
    list: () => [{ name: "World", address: "192.168.1.5:50000" }],
    isListening: () => true,
  } as LanListener;
  return { lan, start, stop };
}

describe("createServerService", () => {
  it("pings an address at most every 30 seconds, sharing one in flight", async () => {
    let clock = 0;
    const ping = vi.fn(() => Promise.resolve(ONLINE));
    const servers = createServerService({ ping, now: () => clock });
    const [a, b] = await Promise.all([
      servers.status("Play.Example.org"),
      servers.status("play.example.org"), // the same server, any case
    ]);
    expect(a).toEqual(ONLINE);
    expect(b).toEqual(ONLINE);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith({ host: "Play.Example.org" });

    clock = 31_000;
    await servers.status("play.example.org");
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("refuses something that isn't an address, and reports a failed ping as offline", async () => {
    const servers = createServerService({
      ping: () => Promise.reject(new Error("boom")),
    });
    expect(() => servers.status("not an address::")).toThrow(
      expect.objectContaining({ code: "INVALID_ADDRESS" }),
    );
    expect(() => servers.status(42)).toThrow(
      expect.objectContaining({ code: "INVALID_ADDRESS" }),
    );
    expect(await servers.status("example.org")).toEqual({ online: false });
  });

  it("listens for LAN worlds while asked, and stops when nobody asks", () => {
    vi.useFakeTimers();
    const { lan, start, stop } = fakeLan();
    const servers = createServerService({ lan: () => lan });
    expect(servers.lanWorlds()).toEqual([
      { name: "World", address: "192.168.1.5:50000" },
    ]);
    expect(start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    servers.lanWorlds();
    vi.advanceTimersByTime(20_000);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11_000);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
