import { safeId } from "./minecraft/paths";

/*
 * Command-line arguments the launcher understands. A profile's desktop shortcut
 * starts it with `--ezl-profile=<id>` to open on that profile's page. No Electron
 * imports, so this is tested on its own.
 */

export const PROFILE_FLAG = "--ezl-profile=";

/**
 * The profile a shortcut asks for. The flag is looked for anywhere (Electron and
 * Chromium add their own switches, and dev runs have the app path first); an id
 * that isn't safe is ignored.
 */
export function profileFromArgv(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (!arg.startsWith(PROFILE_FLAG)) continue;
    const id = arg.slice(PROFILE_FLAG.length);
    try {
      return safeId(id);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The renderer page for a profile (hash routing). */
export const profileRoute = (profileId: string) =>
  `/profiles/${encodeURIComponent(profileId)}`;
