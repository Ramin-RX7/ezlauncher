import { totalmem } from "node:os";
import { app } from "electron";
import { APP_DISPLAY_NAME } from "@shared/app";
import { canCreateShortcuts } from "../shortcuts";
import { handle } from "./register";

export function registerAppIpc(): void {
  handle("app:getInfo", () => ({
    appName: APP_DISPLAY_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    totalMemoryMb: Math.floor(totalmem() / (1024 * 1024)),
    canCreateShortcuts: canCreateShortcuts(),
  }));
}
