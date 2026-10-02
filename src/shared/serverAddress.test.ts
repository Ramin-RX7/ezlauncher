import { describe, expect, it } from "vitest";
import { formatServerAddress, parseServerAddress } from "./serverAddress";

describe("parseServerAddress", () => {
  it.each([
    ["play.example.com", { host: "play.example.com" }],
    [" mc.example.com:25566 ", { host: "mc.example.com", port: 25566 }],
    ["127.0.0.1", { host: "127.0.0.1" }],
    ["localhost:1", { host: "localhost", port: 1 }],
    ["[::1]:25565", { host: "::1", port: 25565 }],
    ["[2001:db8::7]", { host: "2001:db8::7" }],
  ])("reads %s", (text, address) => {
    expect(parseServerAddress(text)).toEqual(address);
  });

  it.each([
    "",
    "-Dx=1",
    "--server",
    "a b",
    "host:0",
    "host:70000",
    "host:port",
    "a:1:2",
    "[::1",
    "[nope]",
    "x".repeat(300),
    "bad/host",
  ])("refuses %j", (text) => {
    expect(parseServerAddress(text)).toBeNull();
  });

  it("writes addresses back as the game takes them", () => {
    expect(formatServerAddress({ host: "::1", port: 25565 })).toBe(
      "[::1]:25565",
    );
    expect(formatServerAddress({ host: "a.b" })).toBe("a.b");
  });
});
