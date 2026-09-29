import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import { is, optimizer } from "@electron-toolkit/utils";
import { APP_DISPLAY_NAME } from "@shared/app";
import { getLogger } from "./log";

function openExternalSafely(url: string): void {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:")
      void shell.openExternal(url);
  } catch {
    // not a valid URL: ignore
  }
}

export function createMainWindow(): BrowserWindow {
  const log = getLogger().child("window");

  const win = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  // F12 opens DevTools in dev; Ctrl+R reload is disabled in production.
  optimizer.watchWindowShortcuts(win);

  // Never open new Electron windows: send links to the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  // The window never navigates away from the app.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    log.error("renderer process gone", details);
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (is.dev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}
