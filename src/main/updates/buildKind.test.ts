import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectBuild } from "./buildKind";

const base = {
  isPackaged: true,
  execPath: join("C:", "Apps", "EZLauncher", "EZLauncher.exe"),
  env: {},
  exists: () => false,
  productName: "EZLauncher",
};

describe("detectBuild", () => {
  it("knows a dev run", () => {
    expect(
      detectBuild({ ...base, platform: "win32", isPackaged: false }).kind,
    ).toBe("dev");
  });

  it("tells the Windows builds apart", () => {
    expect(
      detectBuild({
        ...base,
        platform: "win32",
        env: { PORTABLE_EXECUTABLE_FILE: "D:\\EZ.exe" },
      }),
    ).toEqual({ kind: "portableExe", target: "D:\\EZ.exe" });
    expect(
      detectBuild({
        ...base,
        platform: "win32",
        exists: (p) => p.endsWith("Uninstall EZLauncher.exe"),
      }),
    ).toEqual({ kind: "installer", target: base.execPath });
    expect(detectBuild({ ...base, platform: "win32" })).toEqual({
      kind: "portableZip",
      target: join("C:", "Apps", "EZLauncher"),
    });
  });

  it("updates only the AppImage on Linux", () => {
    expect(
      detectBuild({
        ...base,
        platform: "linux",
        env: { APPIMAGE: "/home/u/EZ.AppImage" },
      }),
    ).toEqual({ kind: "appImage", target: "/home/u/EZ.AppImage" });
    expect(detectBuild({ ...base, platform: "linux" }).kind).toBe("other");
    expect(detectBuild({ ...base, platform: "darwin" }).kind).toBe("other");
  });
});
