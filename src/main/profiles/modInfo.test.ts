import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readModInfoFromJar, UNREADABLE_RANGE } from "./modInfo";
import { fabricJar, PNG } from "./testing/modJars";

describe("readModInfoFromJar", () => {
  it("reads a Fabric mod, with its icon from a size map", () => {
    const jar = fabricJar(
      {
        schemaVersion: 1,
        id: "sodium",
        version: "0.4.1",
        name: "Sodium",
        icon: {
          "16": "small.png",
          "128": "assets/sodium/icon.png",
          "512": "big.png",
        },
        depends: { minecraft: ["1.18.x", "1.19"] },
      },
      { "assets/sodium/icon.png": PNG },
    );
    expect(readModInfoFromJar(jar, "sodium.jar")).toEqual({
      modId: "sodium",
      name: "Sodium",
      version: "0.4.1",
      loaders: ["fabric"],
      mcVersionRange: ["1.18.x", "1.19"],
      rangeFormat: "semver",
      icon: PNG,
    });
  });

  it("tolerates raw line breaks inside Fabric JSON strings", () => {
    const jar = zipSync({
      "fabric.mod.json": strToU8(
        '{"schemaVersion":1,"id":"x","version":"1","description":"two\nlines"}',
      ),
    });
    expect(readModInfoFromJar(jar, "x.jar").modId).toBe("x");
  });

  it("reads a Quilt mod", () => {
    const jar = zipSync({
      "quilt.mod.json": strToU8(
        JSON.stringify({
          schema_version: 1,
          quilt_loader: {
            id: "qsl_thing",
            version: "2.0.0",
            metadata: { name: "QSL Thing" },
            depends: [
              "quilt_loader",
              { id: "minecraft", versions: ">=1.19.2" },
            ],
          },
        }),
      ),
    });
    expect(readModInfoFromJar(jar, "q.jar")).toEqual({
      modId: "qsl_thing",
      name: "QSL Thing",
      version: "2.0.0",
      loaders: ["quilt"],
      mcVersionRange: ">=1.19.2",
      rangeFormat: "semver",
      depends: [{ id: "quilt_loader", range: "*", format: "semver" }],
    });
  });

  it("reads a Forge mods.toml, taking the version from the manifest", () => {
    const jar = zipSync({
      "META-INF/mods.toml": strToU8(`
modLoader="javafml"
loaderVersion="[47,)"
[[mods]]
modId="jei"
version="\${file.jarVersion}"
displayName="Just Enough Items"
[[dependencies.jei]]
modId="forge"
mandatory=true
versionRange="[47,)"
[[dependencies.jei]]
modId="minecraft"
mandatory=true
versionRange="[1.20.1,1.20.2)"
`),
      "META-INF/MANIFEST.MF": strToU8(
        "Manifest-Version: 1.0\nImplementation-Version: 15.2.0.27\n",
      ),
    });
    expect(readModInfoFromJar(jar, "jei.jar")).toEqual({
      modId: "jei",
      name: "Just Enough Items",
      version: "15.2.0.27",
      loaders: ["forge"],
      mcVersionRange: "[1.20.1,1.20.2)",
      rangeFormat: "maven",
      depends: [{ id: "forge", range: "[47,)", format: "maven" }],
    });
  });

  it("recognises NeoForge", () => {
    const jar = zipSync({
      "META-INF/neoforge.mods.toml": strToU8(`
[[mods]]
modId="thing"
version="1.0"
[[dependencies.thing]]
modId="minecraft"
type="required"
versionRange="[1.21,)"
`),
    });
    expect(readModInfoFromJar(jar, "t.jar")).toMatchObject({
      modId: "thing",
      loaders: ["neoforge"],
      mcVersionRange: "[1.21,)",
    });
  });

  it("counts a jar for every loader it has metadata for", () => {
    const jar = zipSync({
      "fabric.mod.json": strToU8(JSON.stringify({ id: "multi", version: "1" })),
      "META-INF/mods.toml": strToU8('[[mods]]\nmodId="multi"\nversion="1"\n'),
    });
    expect(readModInfoFromJar(jar, "multi.jar").loaders).toEqual([
      "fabric",
      "forge",
    ]);
  });

  it("names jars without metadata after the file, as unknown", () => {
    const plain = zipSync({ "a/B.class": new Uint8Array([1]) });
    expect(readModInfoFromJar(plain, "OptiFine_1.18.2.jar")).toEqual({
      name: "OptiFine_1.18.2",
      loaders: [],
    });
    expect(readModInfoFromJar(new Uint8Array([1, 2, 3]), "broken.jar")).toEqual(
      {
        name: "broken",
        loaders: [],
      },
    );
  });

  it("reads Fabric depends, breaks, conflicts and provides", () => {
    const jar = fabricJar({
      schemaVersion: 1,
      id: "indium",
      version: "1.0.9",
      depends: {
        minecraft: "1.18.x",
        fabricloader: ">=0.12",
        sodium: ["0.4.1", "0.4.2"],
        "fabric-renderer-api-v1": "*",
      },
      breaks: { optifabric: "*" },
      conflicts: { canvas: "<2" },
      provides: ["indigo-compat"],
    });
    expect(readModInfoFromJar(jar, "indium.jar")).toMatchObject({
      depends: [
        { id: "fabricloader", range: ">=0.12", format: "semver" },
        { id: "sodium", range: ["0.4.1", "0.4.2"], format: "semver" },
        { id: "fabric-renderer-api-v1", range: "*", format: "semver" },
      ],
      breaks: [{ id: "optifabric", range: "*", format: "semver" }],
      conflicts: [{ id: "canvas", range: "<2", format: "semver" }],
      provides: ["indigo-compat"],
    });
  });

  it("reads Quilt breaks and provides, skipping optional and any-of dependencies", () => {
    const jar = zipSync({
      "quilt.mod.json": strToU8(
        JSON.stringify({
          quilt_loader: {
            id: "q",
            version: "1",
            depends: [
              { id: "qsl", versions: { any: [">=1"] } },
              { id: "extra", optional: true },
              [{ id: "a" }, { id: "b" }],
            ],
            breaks: [{ id: "bad", versions: "<3" }],
            provides: ["q_api", { id: "q_core", version: "1" }],
          },
        }),
      ),
    });
    expect(readModInfoFromJar(jar, "q.jar")).toMatchObject({
      depends: [{ id: "qsl", range: UNREADABLE_RANGE }],
      breaks: [{ id: "bad", range: "<3" }],
      provides: ["q_api", "q_core"],
    });
  });

  it("reads Forge incompatible mods, and skips optional ones", () => {
    const jar = zipSync({
      "META-INF/mods.toml": strToU8(`
[[mods]]
modId="main"
version="1"
[[mods]]
modId="main_api"
version="1"
[[dependencies.main]]
modId="needed"
type="required"
versionRange="[2,)"
[[dependencies.main]]
modId="nice"
type="optional"
[[dependencies.main]]
modId="rival"
type="incompatible"
`),
    });
    expect(readModInfoFromJar(jar, "m.jar")).toMatchObject({
      depends: [{ id: "needed", range: "[2,)", format: "maven" }],
      breaks: [{ id: "rival", range: "*", format: "maven" }],
      provides: ["main_api"],
    });
  });

  it("collects bundled mods at any depth, like Fabric API's modules", () => {
    const deep = fabricJar({ id: "fabric-deep-v1", version: "0.1.0" });
    const renderer = fabricJar(
      {
        id: "fabric-renderer-api-v1",
        version: "0.4.9",
        provides: ["fabric-renderer"],
        jars: [{ file: "META-INF/jars/deep.jar" }],
      },
      { "META-INF/jars/deep.jar": deep },
    );
    const base = fabricJar({ id: "fabric-api-base", version: "0.4.4" });
    const api = fabricJar(
      {
        id: "fabric-api",
        version: "0.77.0+1.18.2",
        provides: ["fabric"],
        jars: [
          { file: "META-INF/jars/base.jar" },
          { file: "META-INF/jars/renderer.jar" },
          { file: "META-INF/jars/missing.jar" },
        ],
      },
      {
        "META-INF/jars/base.jar": base,
        "META-INF/jars/renderer.jar": renderer,
        "META-INF/jars/unlisted.jar": fabricJar({ id: "ignored" }),
      },
    );
    const info = readModInfoFromJar(api, "fabric-api.jar");
    expect(info.provides).toEqual(["fabric"]);
    expect(info.nested).toEqual([
      { modId: "fabric-api-base", version: "0.4.4" },
      {
        modId: "fabric-renderer-api-v1",
        version: "0.4.9",
        provides: ["fabric-renderer"],
      },
      { modId: "fabric-deep-v1", version: "0.1.0" },
    ]);
  });

  it("reads Forge jarjar jars", () => {
    const inner = zipSync({
      "META-INF/mods.toml": strToU8('[[mods]]\nmodId="lib"\nversion="3.1"\n'),
    });
    const jar = zipSync({
      "META-INF/mods.toml": strToU8('[[mods]]\nmodId="outer"\nversion="1"\n'),
      "META-INF/jarjar/lib-3.1.jar": inner,
    });
    expect(readModInfoFromJar(jar, "o.jar").nested).toEqual([
      { modId: "lib", version: "3.1" },
    ]);
  });
});
