import { app } from "electron";
import { handle } from "./register";

export function registerAppIpc(): void {
  handle("app:getInfo", () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
  }));
}
