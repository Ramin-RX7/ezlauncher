import { AppError } from "../core/errors";
import { getLogger } from "../log";
import { readDataDir } from "../settings/bootstrap";
import { createLauncherService, type LauncherService } from "./launcherService";

let service: LauncherService | undefined;

/** Load the data folder from bootstrap.json and start the service, if one is set. */
export async function initFromBootstrap(): Promise<void> {
  const dataDir = await readDataDir();
  if (dataDir) startService(dataDir);
}

export function startService(dataDir: string): void {
  getLogger().info(`data folder: ${dataDir}`);
  service = createLauncherService(dataDir, getLogger());
}

export function hasService(): boolean {
  return service !== undefined;
}

/** The launcher service. Throws if the user hasn't chosen a data folder yet. */
export function getService(): LauncherService {
  if (!service)
    throw new AppError(
      "NO_DATA_DIR",
      "Choose a folder for the launcher data first.",
    );
  return service;
}
