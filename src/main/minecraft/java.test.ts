import { describe, expect, it } from "vitest";
import { pickJavaPlatform } from "./java";
import {
  detectPlatform,
  javaExecutableRelPath,
  javaPlatformKeys,
} from "./platform";
import type { JavaAll } from "./schemas";

const entry = [{ manifest: { url: "u", sha1: "s", size: 1 } }];
const all: JavaAll = {
  "windows-x64": { "jre-legacy": entry, "java-runtime-delta": entry },
  "windows-arm64": { "jre-legacy": [], "java-runtime-delta": entry },
  "mac-os": { "jre-legacy": entry },
  "mac-os-arm64": { "java-runtime-delta": entry },
  linux: { "jre-legacy": entry },
};

describe("Java platform choice", () => {
  it("uses the native build when there is one", () => {
    const arm = detectPlatform("win32", "arm64", "10.0");
    expect(pickJavaPlatform(all, "java-runtime-delta", arm)).toBe(
      "windows-arm64",
    );
  });

  it("falls back to x64 on ARM when a runtime only exists for x64 (Java 8)", () => {
    expect(
      pickJavaPlatform(
        all,
        "jre-legacy",
        detectPlatform("win32", "arm64", "10.0"),
      ),
    ).toBe("windows-x64");
    expect(
      pickJavaPlatform(
        all,
        "jre-legacy",
        detectPlatform("darwin", "arm64", "23"),
      ),
    ).toBe("mac-os");
  });

  it("reports Linux ARM as unavailable", () => {
    const linuxArm = detectPlatform("linux", "arm64", "6.1");
    expect(javaPlatformKeys(linuxArm)).toEqual([]);
    expect(() => pickJavaPlatform(all, "jre-legacy", linuxArm)).toThrow(
      expect.objectContaining({ code: "JAVA_UNAVAILABLE" }),
    );
  });

  it("knows where the Java executable is on each OS", () => {
    expect(javaExecutableRelPath(detectPlatform("win32", "x64", "10"))).toBe(
      "bin/javaw.exe",
    );
    expect(javaExecutableRelPath(detectPlatform("darwin", "x64", "23"))).toBe(
      "jre.bundle/Contents/Home/bin/java",
    );
    expect(javaExecutableRelPath(detectPlatform("linux", "x64", "6"))).toBe(
      "bin/java",
    );
  });
});
