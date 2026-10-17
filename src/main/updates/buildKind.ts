import { basename, dirname, join } from "node:path";
import type { BuildKind } from "@shared/updates";

export interface BuildInfo {
  kind: BuildKind;
  /**
   * What the update replaces: the installed app's exe, the portable exe the user
   * started, the zip's app folder, or the AppImage.
   */
  target?: string;
}

export interface DetectInput {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
  productName: string;
}

/** How this copy of the app was installed, from its environment and what sits next to its exe. */
export function detectBuild({
  platform,
  isPackaged,
  execPath,
  env,
  exists,
  productName,
}: DetectInput): BuildInfo {
  if (!isPackaged) return { kind: "dev" };
  if (platform === "win32") {
    // The single portable exe unpacks itself to a temp folder and runs from there.
    const portable = env["PORTABLE_EXECUTABLE_FILE"];
    if (portable) return { kind: "portableExe", target: portable };
    const dir = dirname(execPath);
    if (exists(join(dir, `Uninstall ${productName}.exe`)))
      return { kind: "installer", target: execPath };
    return { kind: "portableZip", target: dir };
  }
  if (platform === "linux") {
    const appImage = env["APPIMAGE"];
    if (appImage) return { kind: "appImage", target: appImage };
  }
  return { kind: "other" };
}

/** The exe inside a zip build's app folder. */
export function zipExe(appDir: string, execPath: string): string {
  return join(appDir, basename(execPath));
}
