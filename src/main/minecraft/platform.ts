import { release } from "node:os";

/** The machine the game runs on, in Mojang's naming. */
export interface Platform {
  os: "windows" | "osx" | "linux";
  arch: "x86" | "x64" | "arm64" | "arm";
  /** OS version string, matched by `os.version` rules (a regex). */
  osVersion: string;
  classpathSeparator: ";" | ":";
}

export function detectPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  nodeArch: string = process.arch,
  osRelease: string = release(),
): Platform {
  const os =
    nodePlatform === "win32"
      ? "windows"
      : nodePlatform === "darwin"
        ? "osx"
        : "linux";
  const arch =
    nodeArch === "ia32"
      ? "x86"
      : nodeArch === "arm64"
        ? "arm64"
        : nodeArch === "arm"
          ? "arm"
          : "x64";
  return {
    os,
    arch,
    osVersion: osRelease,
    classpathSeparator: os === "windows" ? ";" : ":",
  };
}

/**
 * Keys in Mojang's Java runtime list for this platform, best first.
 * ARM machines fall back to x64 builds (run under emulation), because some runtimes
 * (e.g. Java 8 for old versions) only exist for x64.
 */
export function javaPlatformKeys(platform: Platform): string[] {
  switch (platform.os) {
    case "windows":
      if (platform.arch === "arm64") return ["windows-arm64", "windows-x64"];
      if (platform.arch === "x86") return ["windows-x86"];
      return ["windows-x64"];
    case "osx":
      return platform.arch === "arm64"
        ? ["mac-os-arm64", "mac-os"]
        : ["mac-os"];
    case "linux":
      if (platform.arch === "x86") return ["linux-i386"];
      if (platform.arch === "x64") return ["linux"];
      return []; // Mojang has no Linux ARM runtime
  }
}

/** Path of the Java executable inside a runtime folder, relative to it. */
export function javaExecutableRelPath(platform: Platform): string {
  switch (platform.os) {
    case "windows":
      return "bin/javaw.exe";
    case "osx":
      return "jre.bundle/Contents/Home/bin/java";
    case "linux":
      return "bin/java";
  }
}
