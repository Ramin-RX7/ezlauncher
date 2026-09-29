import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";

/**
 * `bootstrap.json` lives in Electron's userData folder (not in the data folder),
 * because it's what tells us where the data folder is.
 */
const bootstrapSchema = z.object({ schema: z.literal(1), dataDir: z.string() });

const file = () => join(app.getPath("userData"), "bootstrap.json");

export async function readDataDir(): Promise<string | null> {
  try {
    return (await readJson(file(), bootstrapSchema))?.dataDir ?? null;
  } catch {
    return null;
  }
}

export async function writeDataDir(dataDir: string): Promise<void> {
  await writeJsonAtomic(file(), { schema: 1, dataDir });
}

/**
 * Suggested default, following Minecraft's own convention. It must differ from Electron's
 * userData folder, which holds the launcher's browser caches.
 */
export function suggestedDataDir(): string {
  switch (process.platform) {
    case "win32":
      return join(app.getPath("appData"), ".ezlauncher");
    case "darwin":
      return join(app.getPath("appData"), "ezlauncher-data");
    default:
      return join(app.getPath("home"), ".ezlauncher");
  }
}
