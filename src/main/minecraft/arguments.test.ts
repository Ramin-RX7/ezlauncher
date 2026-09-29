import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LaunchIdentity } from "../auth/types";
import { buildLaunchCommand, substitute } from "./arguments";
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

  it("puts extra JVM arguments after the version's and before the main class", () => {
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
      launcherName: "ezlauncher",
      launcherVersion: "1.0",
    });
    expect(cmd.args.slice(3)).toEqual([
      "-XX:+UseG1GC",
      "-Dname=with space ${not_filled}",
      "Main",
      "--demo",
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
