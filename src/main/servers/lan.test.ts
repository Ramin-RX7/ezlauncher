import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createLanListener,
  LAN_GROUP,
  LAN_PORT,
  parseLanAnnouncement,
  type LanSocket,
} from "./lan";

describe("parseLanAnnouncement", () => {
  it("reads the world's name and port", () => {
    expect(
      parseLanAnnouncement("[MOTD]Steve - My §aWorld[/MOTD][AD]51234[/AD]"),
    ).toEqual({ name: "Steve - My World", port: 51234 });
  });

  it("refuses anything else", () => {
    for (const text of [
      "hello",
      "[MOTD]x[/MOTD]",
      "[MOTD]x[/MOTD][AD]0[/AD]",
      "[MOTD]x[/MOTD][AD]99999[/AD]",
      "[MOTD]x[/MOTD][AD]evil.host:25565[/AD]",
    ])
      expect(parseLanAnnouncement(text)).toBeUndefined();
  });
});

class FakeSocket extends EventEmitter implements LanSocket {
  bound?: number;
  groups: string[] = [];
  closed = false;
  bind(port: number, callback: () => void) {
    this.bound = port;
    callback();
    return this;
  }
  addMembership(group: string) {
    this.groups.push(group);
  }
  close() {
    this.closed = true;
    return this;
  }
  announce(text: string, address: string) {
    this.emit("message", Buffer.from(text), { address });
  }
}

describe("createLanListener", () => {
  it("lists worlds announced lately, and forgets quiet ones", () => {
    let clock = 0;
    const socket = new FakeSocket();
    const lan = createLanListener({ socket: () => socket, now: () => clock });
    lan.start();
    expect(socket.bound).toBe(LAN_PORT);
    expect(socket.groups).toEqual([LAN_GROUP]);

    socket.announce("[MOTD]Zed's world[/MOTD][AD]50000[/AD]", "192.168.1.20");
    socket.announce("[MOTD]Alex - Island[/MOTD][AD]61000[/AD]", "192.168.1.5");
    socket.announce("not a world", "192.168.1.9");
    expect(lan.list()).toEqual([
      { name: "Alex - Island", address: "192.168.1.5:61000" },
      { name: "Zed's world", address: "192.168.1.20:50000" },
    ]);

    clock = 8_000;
    socket.announce("[MOTD]Alex - Island[/MOTD][AD]61000[/AD]", "192.168.1.5");
    clock = 12_000;
    expect(lan.list().map((w) => w.address)).toEqual(["192.168.1.5:61000"]);
  });

  it("stops on a socket error, and can start again", () => {
    const sockets: FakeSocket[] = [];
    const lan = createLanListener({
      socket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    lan.start();
    lan.start(); // already listening
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit("error", new Error("EADDRINUSE"));
    expect(lan.isListening()).toBe(false);
    expect(sockets[0]!.closed).toBe(true);
    expect(lan.list()).toEqual([]);
    lan.start();
    expect(sockets).toHaveLength(2);
    lan.stop();
    expect(sockets[1]!.closed).toBe(true);
  });
});
