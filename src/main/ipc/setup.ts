import { isAbsolute } from "node:path";
import { app, BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { AppError } from "../core/errors";
import { getLogger } from "../log";
import { getService, hasService, startService } from "../services/current";
import { moveDataDir } from "../settings/moveData";
import {
  readDataDir,
  suggestedDataDir,
  writeDataDir,
} from "../settings/bootstrap";
import { broadcast, handle } from "./register";

/** The move in progress, so it can be cancelled. */
let moving: AbortController | undefined;

export function registerSetupIpc(): void {
  handle("setup:getState", async () => ({
    dataDir: await readDataDir(),
    suggestedDir: suggestedDataDir(),
  }));

  handle("setup:chooseFolder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle("setup:setDataDir", async (_event, dir) => {
    if (typeof dir !== "string" || !isAbsolute(dir)) {
      throw new AppError("INVALID_PATH", "Choose a full folder path.");
    }
    const wasSet = hasService();
    await writeDataDir(dir);
    if (wasSet) {
      // Everything is tied to the old folder: restart cleanly on the new one.
      app.relaunch();
      app.exit(0);
      return;
    }
    startService(dir);
  });

  // "Move my data there": everything goes to the new folder, then the launcher restarts.
  handle("setup:moveDataDir", async (_event, dir) => {
    if (typeof dir !== "string" || !isAbsolute(dir)) {
      throw new AppError("INVALID_PATH", "Choose a full folder path.");
    }
    const from = await readDataDir();
    if (!from || !hasService())
      throw new AppError("NO_DATA_DIR", "There is no data folder to move yet.");
    if (moving)
      throw new AppError("BUSY", "The data folder is already moving.");
    const service = getService();
    service.prepareToMove();
    moving = new AbortController();
    try {
      const { warnings } = await moveDataDir(from, dir, {
        signal: moving.signal,
        onProgress: (p) => {
          broadcast("setup:moveProgress", p);
        },
      });
      for (const w of warnings)
        getLogger().warn(`moving the data folder: ${w}`);
    } catch (err) {
      service.resumeAfterMove();
      throw err;
    } finally {
      moving = undefined;
    }
    await writeDataDir(dir);
    app.relaunch();
    app.exit(0);
  });
  handle("setup:cancelMove", () => {
    moving?.abort();
  });
}
