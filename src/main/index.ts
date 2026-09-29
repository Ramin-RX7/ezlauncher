import { app, BrowserWindow } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { registerIpc } from "./ipc";
import { initFromBootstrap } from "./services/current";
import { getLogger } from "./log";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | undefined;

// Only one launcher at a time: a second start focuses the running one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    const log = getLogger();
    log.info(
      `starting ezlauncher ${app.getVersion()} on ${process.platform}-${process.arch}`,
    );

    electronApp.setAppUserModelId("com.ezlauncher.app");
    await initFromBootstrap();
    registerIpc();

    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
      mainWindow = undefined;
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0)
        mainWindow = createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  process.on("uncaughtException", (err) => {
    getLogger().error("uncaught exception", err);
  });
  process.on("unhandledRejection", (reason) => {
    getLogger().error("unhandled rejection", reason);
  });
}
