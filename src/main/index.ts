import { app, BrowserWindow } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { registerIpc } from "./ipc";
import { broadcast } from "./ipc/register";
import { initFromBootstrap } from "./services/current";
import { applyDeps, startUpdates } from "./services/updates";
import { getLogger } from "./log";
import { profileFromArgv, profileRoute } from "./startup";
import { finishUpdate, waitForExit } from "./updates/apply";
import { readUpdateFlags } from "./updates/startupFlags";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | undefined;

// Test hook: another settings folder, so a test run never sees the real data folder.
const userDataOverride = process.env["EZL_USER_DATA"];
if (userDataOverride) app.setPath("userData", userDataOverride);

const updateFlags = readUpdateFlags(process.argv);

process.on("uncaughtException", (err) => {
  getLogger().error("uncaught exception", err);
});
process.on("unhandledRejection", (reason) => {
  getLogger().error("unhandled rejection", reason);
});

if (updateFlags.finishTarget) {
  // Started by an update as the new version (the zip build's `<folder>.new`, or
  // the portable `<exe>.update`): put it in place and start it. No window, no
  // lock, no data folder.
  const target = updateFlags.finishTarget;
  void app.whenReady().then(async () => {
    const log = getLogger().child("updates");
    log.info(`finishing the update of ${target}`);
    await finishUpdate({
      target,
      ...(updateFlags.finishSource !== undefined && {
        source: updateFlags.finishSource,
      }),
      ...(updateFlags.waitPid !== undefined && {
        waitPid: updateFlags.waitPid,
      }),
      restart: updateFlags.restart,
      deps: applyDeps(),
    });
    app.exit(0);
  });
} else {
  // Started by an update: let the old version quit first, so the lock is free.
  const ready =
    updateFlags.waitPid !== undefined
      ? waitForExit(updateFlags.waitPid, 30_000)
      : Promise.resolve(true);
  void ready.then(start);
}

function start(): void {
  // Only one launcher at a time: a second start focuses the running one (and opens
  // the profile its shortcut names).
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const profileId = profileFromArgv(argv);
    if (profileId) broadcast("app:openProfile", { profileId });
  });

  void app.whenReady().then(async () => {
    const log = getLogger();
    log.info(
      `starting ezlauncher ${app.getVersion()} on ${process.platform}-${process.arch}`,
    );

    electronApp.setAppUserModelId("com.ezlauncher.app");
    await initFromBootstrap();
    startUpdates({ updateFailed: updateFlags.failed });
    registerIpc();

    const profileId = profileFromArgv(process.argv);
    mainWindow = createMainWindow(
      profileId ? { hash: profileRoute(profileId) } : {},
    );
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
}
