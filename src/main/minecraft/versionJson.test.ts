import { describe, expect, it } from "vitest";
import type { VersionJson } from "./schemas";
import { mergeVersions, resolveVersion } from "./versionJson";

const vanilla: VersionJson = {
  id: "1.18.2",
  type: "release",
  mainClass: "net.minecraft.client.main.Main",
  arguments: {
    game: ["--username", "${auth_player_name}"],
    jvm: ["-cp", "${classpath}"],
  },
  libraries: [
    { name: "org.ow2.asm:asm:9.1" },
    { name: "com.google.guava:guava:31" },
  ],
  assetIndex: { id: "1.18", sha1: "a", size: 1, url: "u" },
  javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
};

const loader: VersionJson = {
  id: "fabric-loader-0.16-1.18.2",
  inheritsFrom: "1.18.2",
  mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
  arguments: {
    game: [],
    jvm: ["-DFabricMcEmu= net.minecraft.client.main.Main "],
  },
  libraries: [
    { name: "org.ow2.asm:asm:9.7" },
    { name: "net.fabricmc:fabric-loader:0.16" },
  ],
};

describe("mergeVersions", () => {
  it("lets the child win, puts its libraries first and replaces duplicates", () => {
    const merged = mergeVersions(vanilla, loader);
    expect(merged.mainClass).toBe(loader.mainClass);
    expect(merged.id).toBe(loader.id);
    expect(merged.javaVersion).toEqual(vanilla.javaVersion); // inherited
    expect(merged.libraries?.map((l) => l.name)).toEqual([
      "org.ow2.asm:asm:9.7",
      "net.fabricmc:fabric-loader:0.16",
      "com.google.guava:guava:31",
    ]);
  });

  it("de-duplicates by classifier too, keeping other classifiers", () => {
    const merged = mergeVersions(
      {
        id: "p",
        libraries: [
          { name: "org.lwjgl:lwjgl:3.2:natives-linux" },
          { name: "org.lwjgl:lwjgl:3.2" },
        ],
      },
      { id: "c", libraries: [{ name: "org.lwjgl:lwjgl:3.3" }] },
    );
    expect(merged.libraries?.map((l) => l.name)).toEqual([
      "org.lwjgl:lwjgl:3.3",
      "org.lwjgl:lwjgl:3.2:natives-linux",
    ]);
  });

  it("appends arguments", () => {
    const merged = mergeVersions(vanilla, loader);
    expect(merged.arguments?.jvm).toEqual([
      "-cp",
      "${classpath}",
      "-DFabricMcEmu= net.minecraft.client.main.Main ",
    ]);
    expect(merged.arguments?.game).toEqual([
      "--username",
      "${auth_player_name}",
    ]);
  });
});

describe("resolveVersion", () => {
  const load = (versions: VersionJson[]) => (id: string) => {
    const v = versions.find((x) => x.id === id);
    return v ? Promise.resolve(v) : Promise.reject(new Error(`missing ${id}`));
  };

  it("follows a multi-level chain", async () => {
    const addon: VersionJson = {
      id: "addon",
      inheritsFrom: loader.id,
      libraries: [{ name: "x:addon:1" }],
    };
    const resolved = await resolveVersion(
      "addon",
      load([vanilla, loader, addon]),
    );
    expect(resolved.chain).toEqual(["addon", loader.id, "1.18.2"]);
    expect(resolved.id).toBe("addon");
    expect(resolved.mainClass).toBe(loader.mainClass);
    expect(resolved.libraries?.[0]?.name).toBe("x:addon:1");
    expect(resolved.inheritsFrom).toBeUndefined();
  });

  it("returns a plain version unchanged apart from its chain", async () => {
    const resolved = await resolveVersion("1.18.2", load([vanilla]));
    expect(resolved.chain).toEqual(["1.18.2"]);
    expect(resolved.libraries).toEqual(vanilla.libraries);
  });

  it("rejects inheritance cycles", async () => {
    const a: VersionJson = { id: "a", inheritsFrom: "b" };
    const b: VersionJson = { id: "b", inheritsFrom: "a" };
    await expect(resolveVersion("a", load([a, b]))).rejects.toMatchObject({
      code: "VERSION_CYCLE",
    });
  });
});
