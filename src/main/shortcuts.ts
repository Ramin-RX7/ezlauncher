import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, shell } from "electron";
import { AppError } from "./core/errors";
import {
  DESKTOP_PROFILE_KEY,
  desktopEntry,
  isPng,
  pngToIco,
  shortcutFileName,
} from "./core/shortcutFiles";
import type { Paths } from "./minecraft/paths";
import { PROFILE_FLAG } from "./startup";

/*
 * Desktop shortcuts that open the launcher on a profile's page: a `.lnk` on
 * Windows, a `.desktop` file on Linux. They run this very launcher (the installed
 * exe, the portable exe, or the AppImage) with `--ezl-profile=<id>`.
 */

const MAX_ICON = 1024 * 1024;

/** The program a shortcut starts, and its arguments before ours; undefined = can't make one. */
function launcherCommand(): { target: string; args: string[] } | undefined {
  // A dev run is `electron <app folder>`.
  const devArgs = app.isPackaged ? [] : [app.getAppPath()];
  if (process.platform === "win32") {
    return {
      // The portable exe runs from a temporary folder; this is the real file.
      target: process.env["PORTABLE_EXECUTABLE_FILE"] ?? process.execPath,
      args: devArgs,
    };
  }
  if (process.platform === "linux") {
    const appImage = process.env["APPIMAGE"];
    if (appImage) return { target: appImage, args: [] };
    return app.isPackaged
      ? undefined
      : { target: process.execPath, args: devArgs };
  }
  return undefined; // macOS isn't built
}

export function canCreateShortcuts(): boolean {
  return launcherCommand() !== undefined;
}

/** Quote one argument for a Windows command line. */
const winArg = (a: string) =>
  /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** Is the file at `path` a shortcut of ours for this profile? */
async function isOurs(path: string, profileId: string): Promise<boolean> {
  const flag = `${PROFILE_FLAG}${profileId}`;
  try {
    if (path.endsWith(".lnk"))
      return shell.readShortcutLink(path).args?.includes(flag) ?? false;
    return (await readFile(path, "utf8")).includes(
      `${DESKTOP_PROFILE_KEY}=${profileId}`,
    );
  } catch {
    return false;
  }
}

/** A free shortcut file name, or the one of ours for this profile (replaced). */
async function shortcutPath(
  dir: string,
  base: string,
  ext: string,
  profileId: string,
): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const path = join(dir, n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`);
    if (!(await exists(path)) || (await isOurs(path, profileId))) return path;
  }
  throw new AppError("SHORTCUT_FAILED", "Too many shortcuts with this name.");
}

export interface ShortcutRequest {
  paths: Paths;
  profile: { id: string; name: string };
  /** The profile's icon, 256×256 PNG, drawn by the renderer. */
  iconPng?: unknown;
  /** One line about it (in the user's language). */
  description: string;
  /** Where to put it; the desktop by default (tests use a scratch folder). */
  dir?: string;
}

/** Make (or update) a profile's desktop shortcut; resolves to its path. */
export async function createProfileShortcut({
  paths,
  profile,
  iconPng,
  description,
  dir = app.getPath("desktop"),
}: ShortcutRequest): Promise<string> {
  const command = launcherCommand();
  if (!command)
    throw new AppError(
      "SHORTCUT_UNSUPPORTED",
      "Shortcuts can't be made for this copy of the launcher.",
    );
  const args = [...command.args, `${PROFILE_FLAG}${profile.id}`];
  const png =
    iconPng instanceof Uint8Array &&
    iconPng.length <= MAX_ICON &&
    isPng(iconPng)
      ? iconPng
      : undefined;
  const base = shortcutFileName(profile.name);

  try {
    if (process.platform === "win32") {
      let icon: string | undefined;
      if (png) {
        icon = paths.shortcutIcon(profile.id, "ico");
        await mkdir(dirname(icon), { recursive: true });
        await writeFile(icon, pngToIco(png));
      }
      const path = await shortcutPath(dir, base, ".lnk", profile.id);
      // "create" makes it or overwrites it ("replace" fails when it doesn't exist yet).
      const ok = shell.writeShortcutLink(path, "create", {
        target: command.target,
        args: args.map(winArg).join(" "),
        description: description.slice(0, 250),
        icon: icon ?? command.target,
        iconIndex: 0,
        appUserModelId: "com.ezlauncher.app",
      });
      if (!ok) throw new Error("writeShortcutLink failed");
      return path;
    }
    let icon: string | undefined;
    if (png) {
      icon = paths.shortcutIcon(profile.id, "png");
      await mkdir(dirname(icon), { recursive: true });
      await writeFile(icon, png);
    }
    const path = await shortcutPath(dir, base, ".desktop", profile.id);
    await writeFile(
      path,
      desktopEntry({
        name: profile.name,
        comment: description,
        exec: [command.target, ...args],
        ...(icon && { icon }),
        profileId: profile.id,
      }),
    );
    await chmod(path, 0o755); // file managers only start executable entries
    return path;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("SHORTCUT_FAILED", "The shortcut couldn't be made.", {
      cause: err,
    });
  }
}
