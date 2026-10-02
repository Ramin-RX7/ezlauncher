import {
  BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import { getService } from "../services/current";
import { handle } from "./register";

const FILTERS = [{ name: "Modrinth mod packs", extensions: ["mrpack"] }];

export function registerModpacksIpc(): void {
  handle("profiles:icon", (_e, id) => getService().profileIcon(id));

  // The dialogs run here, so the paths never come from the renderer.
  handle("modpacks:pickFile", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: FILTERS,
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const path = picked.filePaths[0];
    if (picked.canceled || path === undefined) return null;
    return getService().modpacks.inspectFile(path);
  });
  handle("modpacks:inspectFile", (_e, path) =>
    getService().modpacks.inspectFile(path),
  );
  handle("modpacks:search", (_e, { query, offset }) =>
    getService().searchModpacks(query, offset),
  );
  handle("modpacks:versions", (_e, options) =>
    getService().modpacks.versions(options),
  );
  handle("modpacks:inspectRemote", (_e, options) =>
    getService().modpacks.inspectRemote(options),
  );
  handle("modpacks:import", (_e, options) =>
    getService().modpacks.importPack(options),
  );
  handle("modpacks:cancel", (_e, token) => getService().modpacks.cancel(token));
  handle("modpacks:discard", (_e, token) =>
    getService().modpacks.discard(token),
  );

  handle("modpacks:updateVersions", (_e, profileId) =>
    getService().modpacks.updateVersions(profileId),
  );
  handle("modpacks:planUpdate", (_e, options) =>
    getService().modpacks.planUpdate(options),
  );
  handle("modpacks:applyUpdate", (_e, options) =>
    getService().modpacks.applyUpdate(options),
  );
  handle("modpacks:discardUpdate", (_e, token) =>
    getService().modpacks.discardUpdate(token),
  );

  handle("modpacks:exportOptions", (_e, profileId) =>
    getService().modpacks.exportOptions(profileId),
  );
  handle("modpacks:export", async (event, { profileId, ...options }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const safe = (value: unknown) =>
      (typeof value === "string" ? value : "").replace(/[<>:"/\\|?*]+/g, "_");
    const saveOptions: SaveDialogOptions = {
      defaultPath: `${safe(options.name)}-${safe(options.versionNumber)}.mrpack`,
      filters: FILTERS,
    };
    const picked = win
      ? await dialog.showSaveDialog(win, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (picked.canceled || !picked.filePath) return null;
    return getService().modpacks.exportPack(
      profileId,
      options,
      picked.filePath,
    );
  });
}
