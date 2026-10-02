import { describe, expect, it } from "vitest";
import { assertSupported, parseIndex } from "./mrpackIndex";
import { packIndex } from "./testing/makeMrpack";

describe("parseIndex", () => {
  it("reads the pack, its requirements and its client files", () => {
    const index = parseIndex(
      packIndex({
        summary: "Fast",
        files: [
          { path: "mods/a.jar", body: "a" },
          {
            path: "mods/server-only.jar",
            body: "s",
            env: { client: "unsupported" },
          },
          { path: "mods/minimap.jar", body: "m", env: { client: "optional" } },
        ],
      }),
    );
    expect(index).toMatchObject({
      name: "Test Pack",
      versionNumber: "1.0.0",
      summary: "Fast",
      requires: {
        gameVersion: "1.20.1",
        loader: "fabric",
        loaderVersion: "0.16.0",
      },
    });
    expect(index.files.map((f) => [f.path, f.optional])).toEqual([
      ["mods/a.jar", false],
      ["mods/minimap.jar", true],
    ]);
  });

  it("knows Quilt, vanilla and Forge packs", () => {
    expect(
      parseIndex(
        packIndex({
          dependencies: { minecraft: "1.21", "quilt-loader": "0.26.0" },
        }),
      ).requires,
    ).toEqual({
      gameVersion: "1.21",
      loader: "quilt",
      loaderVersion: "0.26.0",
    });
    const vanilla = parseIndex(
      packIndex({ dependencies: { minecraft: "1.21" } }),
    );
    expect(vanilla.requires).toEqual({ gameVersion: "1.21", loader: null });
    expect(() => {
      assertSupported(vanilla.requires);
    }).not.toThrow();
    const forge = parseIndex(
      packIndex({ dependencies: { minecraft: "1.20.1", forge: "47.2.0" } }),
    );
    expect(() => {
      assertSupported(forge.requires);
    }).toThrow(expect.objectContaining({ code: "MODPACK_LOADER_UNSUPPORTED" }));
  });

  it.each([
    ["../evil.jar", "MODPACK_UNSAFE_PATH"],
    ["mods/../../evil.jar", "MODPACK_UNSAFE_PATH"],
    ["/etc/passwd", "MODPACK_UNSAFE_PATH"],
    ["C:/Windows/x.dll", "MODPACK_UNSAFE_PATH"],
    ["mods\\x.jar", "MODPACK_UNSAFE_PATH"],
  ])("refuses the path %s", (path, code) => {
    expect(() =>
      parseIndex(packIndex({ files: [{ path, body: "x" }] })),
    ).toThrow(expect.objectContaining({ code }));
  });

  it("refuses downloads from other sites or over http", () => {
    for (const url of [
      "https://evil.example.com/a.jar",
      "http://cdn.modrinth.com/a.jar",
    ]) {
      expect(() =>
        parseIndex(
          packIndex({ files: [{ path: "mods/a.jar", body: "a", url }] }),
        ),
      ).toThrow(expect.objectContaining({ code: "MODPACK_BAD_HOST" }));
    }
  });

  it("refuses other formats and broken indexes", () => {
    expect(() => parseIndex({ ...packIndex(), formatVersion: 2 })).toThrow(
      expect.objectContaining({ code: "MODPACK_FORMAT_UNSUPPORTED" }),
    );
    expect(() => parseIndex({ name: "x" })).toThrow(
      expect.objectContaining({ code: "MODPACK_INVALID" }),
    );
    expect(() =>
      parseIndex(packIndex({ dependencies: { "fabric-loader": "1" } })),
    ).toThrow(expect.objectContaining({ code: "MODPACK_INVALID" }));
  });
});
