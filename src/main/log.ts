import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { createLogger, type Logger } from "./core/logger";

let root: Logger | undefined;

/** The app-wide logger, writing to Electron's logs folder. Call after `app` is ready. */
export function getLogger(): Logger {
  root ??= createLogger({
    dir: app.getPath("logs"),
    level: is.dev ? "debug" : "info",
  });
  return root;
}
