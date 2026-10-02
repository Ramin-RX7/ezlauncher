import { describe, expect, it } from "vitest";
import {
  decodeMutf8,
  encodeMutf8,
  get,
  readNbt,
  TAG,
  writeNbt,
  type Compound,
} from "./nbtTree";
import { checkEdits, readServers, writeServers } from "./serverList";
import { makeServersDat } from "./testing/serversDat";

describe("nbtTree", () => {
  it("writes back exactly what it read, for every tag type", () => {
    const root: Compound = {
      type: TAG.COMPOUND,
      value: [
        ["b", { type: TAG.BYTE, value: -5 }],
        ["s", { type: TAG.SHORT, value: -300 }],
        ["i", { type: TAG.INT, value: 123456 }],
        ["l", { type: TAG.LONG, value: -9007199254740993n }],
        ["f", { type: TAG.FLOAT, value: 0.5 }],
        ["d", { type: TAG.DOUBLE, value: Math.PI }],
        ["ba", { type: TAG.BYTE_ARRAY, value: new Uint8Array([1, 2, 255]) }],
        ["str", { type: TAG.STRING, value: "héllo \u0000 😀" }],
        [
          "list",
          {
            type: TAG.LIST,
            itemType: TAG.INT,
            value: [
              { type: TAG.INT, value: 1 },
              { type: TAG.INT, value: 2 },
            ],
          },
        ],
        ["empty", { type: TAG.LIST, itemType: TAG.END, value: [] }],
        ["ia", { type: TAG.INT_ARRAY, value: new Int32Array([-1, 7]) }],
        ["la", { type: TAG.LONG_ARRAY, value: new BigInt64Array([1n, -2n]) }],
        [
          "nested",
          {
            type: TAG.COMPOUND,
            value: [["x", { type: TAG.STRING, value: "y" }]],
          },
        ],
      ],
    };
    const bytes = writeNbt("", root);
    const back = readNbt(bytes);
    expect(back.root).toEqual(root);
    expect(writeNbt(back.name, back.root)).toEqual(bytes);
  });

  it("uses Java's modified UTF-8", () => {
    expect([...encodeMutf8("\u0000")]).toEqual([0xc0, 0x80]);
    // An emoji is two 3-byte surrogates, not one 4-byte sequence.
    expect(encodeMutf8("😀")).toHaveLength(6);
    expect(decodeMutf8(encodeMutf8("a\u0000😀é"))).toBe("a\u0000😀é");
  });

  it("refuses broken files", () => {
    expect(() => readNbt(new Uint8Array([10, 0, 0, 8]))).toThrow();
    expect(() => readNbt(new Uint8Array([8, 0, 0]))).toThrow();
  });
});

const GAME_FILE = () =>
  makeServersDat([
    { name: "Hypixel", ip: "mc.hypixel.net", icon: "iVBORw0KGgo=" },
    { name: "Direct", ip: "10.0.0.5", hidden: true },
    { name: "Friends", ip: "friends.example.com:25566" },
  ]);

describe("server list", () => {
  it("reads the visible servers with their resource pack choice", () => {
    expect(readServers(GAME_FILE())).toEqual([
      {
        key: 0,
        name: "Hypixel",
        address: "mc.hypixel.net",
        resourcePacks: "enabled", // the helper writes acceptTextures: 1
        icon: "iVBORw0KGgo=",
      },
      {
        key: 2,
        name: "Friends",
        address: "friends.example.com:25566",
        resourcePacks: "enabled",
      },
    ]);
    expect(readServers(undefined)).toEqual([]);
  });

  it("edits, reorders, adds and removes, keeping each entry's other tags", () => {
    const out = writeServers(GAME_FILE(), [
      {
        key: 2,
        name: "Friends ✨",
        address: "friends.example.com:25566",
        resourcePacks: "prompt",
      },
      { name: "New", address: "new.example.com", resourcePacks: "disabled" },
      // Hypixel (key 0) was removed.
    ]);
    const { root } = readNbt(out);
    const list = get(root, "servers");
    if (list?.type !== TAG.LIST) throw new Error("no list");
    const names = list.value.map((c) =>
      c.type === TAG.COMPOUND ? get(c, "name") : undefined,
    );
    // The hidden entry stays at its place (index 1).
    expect(names.map((n) => (n?.type === TAG.STRING ? n.value : ""))).toEqual([
      "Friends ✨",
      "Direct",
      "New",
    ]);
    const friends = list.value[0];
    if (friends?.type !== TAG.COMPOUND) throw new Error("no entry");
    expect(get(friends, "acceptTextures")).toBeUndefined(); // prompt
    expect(readServers(out).map((s) => [s.name, s.resourcePacks])).toEqual([
      ["Friends ✨", "prompt"],
      ["New", "disabled"],
    ]);
  });

  it("keeps the icon of a server that was only renamed", () => {
    const out = writeServers(GAME_FILE(), [
      {
        key: 0,
        name: "Hypixel!",
        address: "mc.hypixel.net",
        resourcePacks: "enabled",
      },
      {
        key: 2,
        name: "Friends",
        address: "friends.example.com:25566",
        resourcePacks: "enabled",
      },
    ]);
    expect(readServers(out)[0]).toMatchObject({
      name: "Hypixel!",
      icon: "iVBORw0KGgo=",
    });
  });

  it("makes a new file when the game hasn't made one yet", () => {
    const out = writeServers(undefined, [
      { name: "A", address: "a.example.com", resourcePacks: "prompt" },
    ]);
    expect(readServers(out)).toEqual([
      { key: 0, name: "A", address: "a.example.com", resourcePacks: "prompt" },
    ]);
  });

  it("checks what the renderer sends", () => {
    expect(() =>
      checkEdits([{ name: "", address: "a.b", resourcePacks: "prompt" }]),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() =>
      checkEdits([{ name: "x", address: "--evil", resourcePacks: "prompt" }]),
    ).toThrow(expect.objectContaining({ code: "INVALID_ADDRESS" }));
    expect(
      checkEdits([{ key: 1, name: " A ", address: "a.b", resourcePacks: "x" }]),
    ).toEqual([{ key: 1, name: "A", address: "a.b", resourcePacks: "prompt" }]);
  });
});
