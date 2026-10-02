import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LaunchIdentity } from "../auth/types";
import { buildLaunchCommand, quickPlaySupport, substitute } from "./arguments";
import type { InstalledVersion } from "./installer";
import { createPaths } from "./paths";
import { detectPlatform, type Platform } from "./platform";

const paths = createPaths("/data");
const identity: LaunchIdentity = {
  username: "Steve",
  uuid: "b50ad385829d3141a2167e7d7539ba7f",
  accessToken: "0",
  userType: "legacy",
};

function installed(version: InstalledVersion["version"]): InstalledVersion {
  return {
    version,
    libraries: {
      classpath: [
        { dest: "/data/libraries/a.jar" },
        { dest: "/data/libraries/b.jar" },
      ],
      natives: [],
    },
    clientJar: "/data/versions/v/v.jar",
    assetIndex: { objects: {} },
    assetIndexId: "idx",
    javaPath: "/java",
  };
}

function command(version: InstalledVersion["version"], platform: Platform) {
  return buildLaunchCommand({
    installed: installed(version),
    identity,
    paths,
    platform,
    gameDir: "/data/games/v",
    memoryMaxMb: 3072,
    launcherName: "ezlauncher",
    launcherVersion: "1.0",
  });
}

const linux = detectPlatform("linux", "x64", "6.1");
const mac = detectPlatform("darwin", "arm64", "23.0");

describe("substitute", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    const unknown: string[] = [];
    expect(substitute("${a}-${b}", { a: "1" }, (n) => unknown.push(n))).toBe(
      "1-${b}",
    );
    expect(unknown).toEqual(["b"]);
  });
});

describe("buildLaunchCommand", () => {
  it("builds a modern command with rule-filtered arguments", () => {
    const cmd = command(
      {
        id: "v",
        chain: ["v"],
        type: "release",
        mainClass: "net.minecraft.client.main.Main",
        arguments: {
          jvm: [
            {
              rules: [{ action: "allow", os: { name: "osx" } }],
              value: ["-XstartOnFirstThread"],
            },
            "-Djava.library.path=${natives_directory}",
            "-cp",
            "${classpath}",
          ],
          game: [
            "--username",
            "${auth_player_name}",
            "--uuid",
            "${auth_uuid}",
            "--assetIndex",
            "${assets_index_name}",
            {
              rules: [{ action: "allow", features: { is_demo_user: true } }],
              value: "--demo",
            },
            {
              rules: [
                { action: "allow", features: { has_custom_resolution: true } },
              ],
              value: ["--width", "${resolution_width}"],
            },
          ],
        },
        logging: {
          client: {
            argument: "-Dlog4j.configurationFile=${path}",
            file: { id: "client-1.12.xml", sha1: "x", size: 1, url: "u" },
          },
        },
      },
      linux,
    );

    expect(cmd.javaPath).toBe("/java");
    expect(cmd.cwd).toBe("/data/games/v");
    expect(cmd.args).toEqual([
      "-Xmx3072M",
      `-Djava.library.path=${join("/data", "versions", "v", "natives")}`,
      "-cp",
      "/data/libraries/a.jar:/data/libraries/b.jar:/data/versions/v/v.jar",
      `-Dlog4j.configurationFile=${join("/data", "assets", "log_configs", "client-1.12.xml")}`,
      "net.minecraft.client.main.Main",
      "--username",
      "Steve",
      "--uuid",
      identity.uuid,
      "--assetIndex",
      "idx",
    ]);
    expect(
      command(
        {
          id: "v",
          chain: ["v"],
          arguments: {
            jvm: [
              {
                rules: [{ action: "allow", os: { name: "osx" } }],
                value: ["-XstartOnFirstThread"],
              },
            ],
          },
        },
        mac,
      ).args,
    ).toContain("-XstartOnFirstThread");
  });

  it("builds a legacy command with default JVM arguments", () => {
    const cmd = command(
      {
        id: "b1.7.3",
        chain: ["b1.7.3"],
        mainClass: "net.minecraft.launchwrapper.Launch",
        minecraftArguments:
          "${auth_player_name} ${auth_session} --gameDir ${game_directory}  --assetsDir ${game_assets}",
      },
      linux,
    );
    expect(cmd.args).toEqual([
      "-Xmx3072M",
      `-Djava.library.path=${join("/data", "versions", "b1.7.3", "natives")}`,
      "-cp",
      "/data/libraries/a.jar:/data/libraries/b.jar:/data/versions/v/v.jar",
      "net.minecraft.launchwrapper.Launch",
      "Steve",
      "0",
      "--gameDir",
      "/data/games/v",
      "--assetsDir",
      join("/data", "assets"),
    ]);
  });

  it("keeps the legacy JVM arguments when a mod loader adds its own", () => {
    const cmd = command(
      {
        id: "loader-1.8.9",
        chain: ["loader-1.8.9", "1.8.9"],
        mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
        minecraftArguments: "--username ${auth_player_name}",
        arguments: { jvm: ["-DFabricMcEmu= x "] },
      },
      linux,
    );
    expect(cmd.args.slice(0, 5)).toEqual([
      "-Xmx3072M",
      `-Djava.library.path=${join("/data", "versions", "loader-1.8.9", "natives")}`,
      "-cp",
      "/data/libraries/a.jar:/data/libraries/b.jar:/data/versions/v/v.jar",
      "-DFabricMcEmu= x ",
    ]);
  });

  it("puts extra JVM arguments before the main class, and extra game arguments last", () => {
    const cmd = buildLaunchCommand({
      installed: installed({
        id: "v",
        chain: ["v"],
        mainClass: "Main",
        arguments: { jvm: ["-cp", "${classpath}"], game: ["--demo"] },
      }),
      identity,
      paths,
      platform: linux,
      gameDir: "/data/profiles/p",
      memoryMaxMb: 1024,
      extraJvmArgs: ["-XX:+UseG1GC", "-Dname=with space ${not_filled}"],
      extraGameArgs: ["--width", "1280"],
      launcherName: "ezlauncher",
      launcherVersion: "1.0",
    });
    expect(cmd.args.slice(3)).toEqual([
      "-XX:+UseG1GC",
      "-Dname=with space ${not_filled}",
      "Main",
      "--demo",
      "--width",
      "1280",
    ]);
  });

  it("uses the Windows classpath separator and adds macOS first-thread flag for legacy versions", () => {
    const windows = detectPlatform("win32", "x64", "10.0");
    const legacy = {
      id: "1.8.9",
      chain: ["1.8.9"],
      minecraftArguments: "--username ${auth_player_name}",
    };
    expect(command(legacy, windows).args).toContain(
      "/data/libraries/a.jar;/data/libraries/b.jar;/data/versions/v/v.jar",
    );
    expect(command(legacy, mac).args[1]).toBe("-XstartOnFirstThread");
  });
});

describe("Quick Play", () => {
  /** The game arguments of a 1.20+ version (as in 26.3's JSON). */
  const modern: InstalledVersion["version"] = {
    id: "26.3",
    chain: ["26.3"],
    mainClass: "net.minecraft.client.main.Main",
    arguments: {
      jvm: ["-cp", "${classpath}"],
      game: [
        "--username",
        "${auth_player_name}",
        {
          rules: [
            { action: "allow", features: { has_quick_plays_support: true } },
          ],
          value: ["--quickPlayPath", "${quickPlayPath}"],
        },
        {
          rules: [
            { action: "allow", features: { is_quick_play_singleplayer: true } },
          ],
          value: ["--quickPlaySingleplayer", "${quickPlaySingleplayer}"],
        },
        {
          rules: [
            { action: "allow", features: { is_quick_play_multiplayer: true } },
          ],
          value: ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"],
        },
      ],
    },
  };
  const legacy: InstalledVersion["version"] = {
    id: "1.12.2",
    chain: ["1.12.2"],
    mainClass: "net.minecraft.client.main.Main",
    minecraftArguments:
      "--username ${auth_player_name} --version ${version_name}",
  };
  const run = (
    version: InstalledVersion["version"],
    quickPlay?: Parameters<typeof buildLaunchCommand>[0]["quickPlay"],
  ) =>
    buildLaunchCommand({
      installed: installed(version),
      identity,
      paths,
      platform: linux,
      gameDir: "/g",
      memoryMaxMb: 1024,
      launcherName: "ezlauncher",
      launcherVersion: "1.0",
      ...(quickPlay && { quickPlay }),
    }).args;

  it("adds no Quick Play arguments for a normal start", () => {
    expect(run(modern).join(" ")).not.toContain("quickPlay");
  });

  it("starts into a world or onto a server on 1.20+", () => {
    const world = run(modern, { kind: "world", worldId: "New World (1)" });
    expect(world.slice(-2)).toEqual([
      "--quickPlaySingleplayer",
      "New World (1)",
    ]);
    expect(world.join(" ")).not.toContain("quickPlayPath");
    const server = run(modern, {
      kind: "server",
      address: { host: "play.example.com", port: 25566 },
    });
    expect(server.slice(-2)).toEqual([
      "--quickPlayMultiplayer",
      "play.example.com:25566",
    ]);
  });

  it("joins a server with --server/--port on old versions; worlds need 1.20", () => {
    expect(
      run(legacy, {
        kind: "server",
        address: { host: "mc.example.com" },
      }).slice(-4),
    ).toEqual(["--server", "mc.example.com", "--port", "25565"]);
    expect(() => run(legacy, { kind: "world", worldId: "W" })).toThrow(
      expect.objectContaining({ code: "QUICKPLAY_UNSUPPORTED" }),
    );
    expect(quickPlaySupport(legacy)).toEqual({
      worlds: false,
      servers: "legacy",
    });
    expect(quickPlaySupport(modern)).toEqual({
      worlds: true,
      servers: "quickPlay",
    });
  });
});
