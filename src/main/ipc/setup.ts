import { isAbsolute } from "node:path";
import { app, BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { AppError } from "../core/errors";
import { hasService, startService } from "../services/current";
import {
  readDataDir,
  suggestedDataDir,
  writeDataDir,
} from "../settings/bootstrap";
import { handle } from "./register";

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
}
