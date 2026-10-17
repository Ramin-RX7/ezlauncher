import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { app, net } from "electron";
import { APP_DISPLAY_NAME } from "@shared/app";
import { broadcast } from "../ipc/register";
import { getLogger } from "../log";
import type { ApplyDeps } from "../updates/apply";
import { cleanupAfterUpdate } from "../updates/apply";
import { detectBuild, type BuildInfo } from "../updates/buildKind";
import {
  createUpdateService,
  updateStateFile,
  type UpdateService,
} from "../updates/service";
import { getService, hasService } from "./current";

/*
 * The app's one update service, wired to Electron. Created in index.ts before the
 * window, so it works before a data folder is chosen too.
 */

let service: UpdateService | undefined;

export function currentBuild(): BuildInfo {
  return detectBuild({
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    env: process.env,
    exists: existsSync,
    productName: APP_DISPLAY_NAME,
  });
}

export function applyDeps(): ApplyDeps {
  return {
    spawnDetached: (command, args) => {
      spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    },
    pid: process.pid,
    tempDir: join(app.getPath("temp"), "ezlauncher-update"),
    exeName: basename(process.execPath),
    logger: getLogger().child("updates"),
  };
}

export function startUpdates({
  updateFailed,
}: {
  updateFailed: boolean;
}): void {
  const log = getLogger().child("updates");
  const build = currentBuild();
  const deps = applyDeps();
  // A test hook for checking updates end to end against a local feed.
  const feedUrl = process.env["EZL_UPDATE_FEED"];
  if (feedUrl) log.warn(`using the update feed ${feedUrl}`);
  log.info(`build: ${build.kind}${build.target ? ` (${build.target})` : ""}`);
  void cleanupAfterUpdate(build, deps.tempDir, log);

  service = createUpdateService({
    fetch: (url, init) => net.fetch(url, init),
    version: app.getVersion(),
    build,
    stateFile: updateStateFile(app.getPath("userData")),
    userAgent: `ezlauncher/${app.getVersion()} (github.com/Ramin-RX7/ezlauncher)`,
    apply: deps,
    isBusy: () => hasService() && getService().isAnyBusy(),
    onState: (state) => {
      broadcast("updates:state", state);
    },
    logger: log,
    updateFailed,
    ...(feedUrl && { feedUrl }),
  });
  service.start();

  // Test hook (with EZL_UPDATE_FEED): check, download and install by itself.
  if (feedUrl && process.env["EZL_UPDATE_TEST"] === "install") {
    const s = service;
    void (async () => {
      const state = await s.check({ manual: true });
      if (state.status !== "available") return;
      await s.download();
      await s.install({ restart: true });
      app.quit();
    })().catch((err: unknown) => {
      log.error("update test failed", err);
    });
  }

  // "Later" on a downloaded update: it goes in when the launcher closes.
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting || service?.getState().status !== "ready") return;
    event.preventDefault();
    quitting = true;
    void service.installOnQuit().finally(() => {
      app.quit();
    });
  });
}

export function getUpdates(): UpdateService {
  if (!service) throw new Error("The update service isn't started.");
  return service;
}
