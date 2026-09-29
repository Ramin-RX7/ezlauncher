import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectLibraries, MOJANG_LIBRARIES_URL } from "./libraries";
import { coordinateToPath, libraryKey, parseCoordinate } from "./maven";
import { createPaths } from "./paths";
import { detectPlatform } from "./platform";
import type { VersionJson } from "./schemas";

const paths = createPaths("/data");
const linux = { platform: detectPlatform("linux", "x64", "6.1") };
const windows32 = { platform: detectPlatform("win32", "ia32", "10.0") };
const lib = (rel: string) => join("/data", "libraries", ...rel.split("/"));

describe("maven coordinates", () => {
  it("parses and builds paths with classifier and extension", () => {
    const c = parseCoordinate("org.lwjgl:lwjgl:3.3.3:natives-linux");
    expect(c).toEqual({
      group: "org.lwjgl",
      artifact: "lwjgl",
      version: "3.3.3",
      classifier: "natives-linux",
      extension: "jar",
    });
    expect(coordinateToPath(c!)).toBe(
      "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar",
    );
    expect(coordinateToPath(parseCoordinate("a.b:c:1@zip")!)).toBe(
      "a/b/c/1/c-1.zip",
    );
  });

  it("keys libraries by group:artifact[:classifier]", () => {
    expect(libraryKey("org.ow2.asm:asm:9.7")).toBe("org.ow2.asm:asm");
    expect(libraryKey("org.lwjgl:lwjgl:3.3.3:natives-linux")).toBe(
      "org.lwjgl:lwjgl:natives-linux",
    );
  });
});

describe("collectLibraries", () => {
  it("uses artifact downloads and applies rules", () => {
    const version: VersionJson = {
      id: "x",
      libraries: [
        {
          name: "com.example:shared:1.0",
          downloads: {
            artifact: {
              path: "com/example/shared/1.0/shared-1.0.jar",
              sha1: "aa",
              size: 3,
              url: "https://x/shared.jar",
            },
          },
        },
        {
          name: "org.lwjgl:lwjgl:3.3.3:natives-macos",
          downloads: {
            artifact: {
              path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-macos.jar",
              url: "https://x/mac.jar",
            },
          },
          rules: [{ action: "allow", os: { name: "osx" } }],
        },
      ],
    };
    const { classpath, natives } = collectLibraries(version, linux, paths);
    expect(classpath).toEqual([
      {
        dest: lib("com/example/shared/1.0/shared-1.0.jar"),
        url: "https://x/shared.jar",
        sha1: "aa",
        size: 3,
      },
    ]);
    expect(natives).toEqual([]);
  });

  it("picks old-style native classifiers, including ${arch}", () => {
    const version: VersionJson = {
      id: "x",
      libraries: [
        {
          name: "tv.twitch:twitch-platform:5.16",
          natives: {
            windows: "natives-windows-${arch}",
            linux: "natives-linux",
          },
          extract: { exclude: ["META-INF/"] },
          downloads: {
            classifiers: {
              "natives-windows-32": {
                path: "tv/twitch/w32.jar",
                url: "https://x/w32.jar",
                sha1: "b",
                size: 1,
              },
              "natives-linux": {
                path: "tv/twitch/linux.jar",
                url: "https://x/linux.jar",
                sha1: "c",
                size: 2,
              },
            },
          },
        },
      ],
    };
    const win = collectLibraries(version, windows32, paths);
    expect(win.natives).toEqual([
      {
        task: {
          dest: lib("tv/twitch/w32.jar"),
          url: "https://x/w32.jar",
          sha1: "b",
          size: 1,
        },
        exclude: ["META-INF/"],
      },
    ]);
    // Only natives, no artifact: nothing on the classpath.
    expect(win.classpath).toEqual([]);
    expect(collectLibraries(version, linux, paths).natives[0]?.task.url).toBe(
      "https://x/linux.jar",
    );
  });

  it("keeps both the artifact and the natives when a library has both (LWJGL 3 on 1.13–1.18)", () => {
    const version: VersionJson = {
      id: "x",
      libraries: [
        {
          name: "org.lwjgl:lwjgl:3.2.2",
          natives: { linux: "natives-linux" },
          downloads: {
            artifact: {
              path: "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
              url: "https://x/l.jar",
            },
            classifiers: {
              "natives-linux": {
                path: "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-linux.jar",
                url: "https://x/n.jar",
              },
            },
          },
        },
      ],
    };
    const { classpath, natives } = collectLibraries(version, linux, paths);
    expect(classpath.map((t) => t.url)).toEqual(["https://x/l.jar"]);
    expect(natives.map((n) => n.task.url)).toEqual(["https://x/n.jar"]);
  });

  it("falls back to the Maven coordinate and repository url (mod loader libraries)", () => {
    const version: VersionJson = {
      id: "x",
      libraries: [
        {
          name: "net.fabricmc:fabric-loader:0.16.10",
          url: "https://maven.fabricmc.net",
        },
        { name: "org.ow2.asm:asm:9.7" },
      ],
    };
    const { classpath } = collectLibraries(version, linux, paths);
    expect(classpath.map((t) => t.url)).toEqual([
      "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.10/fabric-loader-0.16.10.jar",
      `${MOJANG_LIBRARIES_URL}org/ow2/asm/asm/9.7/asm-9.7.jar`,
    ]);
  });

  it("treats an empty artifact url as a locally produced file", () => {
    const version: VersionJson = {
      id: "x",
      libraries: [
        {
          name: "net.minecraftforge:forge:1:client",
          downloads: { artifact: { path: "f/client.jar", url: "" } },
        },
      ],
    };
    expect(collectLibraries(version, linux, paths).classpath).toEqual([
      { dest: lib("f/client.jar") },
    ]);
  });
});
