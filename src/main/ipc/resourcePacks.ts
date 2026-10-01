import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { getService } from "../services/current";
import { handle } from "./register";

export function registerResourcePacksIpc(): void {
  handle("resourcePacks:library", () => getService().packLibrary());
  handle("resourcePacks:icon", (_e, sha1) => getService().packIcon(sha1));
  handle("resourcePacks:folderIcon", (_e, profileId, name) =>
    getService().packFolderIcon(profileId, name),
  );
  handle("resourcePacks:profile", (_e, profileId) =>
    getService().profilePacks(profileId),
  );
  handle("resourcePacks:setActive", (_e, { profileId, active }) =>
    getService().setActivePacks(profileId, active),
  );

  // The dialog runs here, so these paths never come from the renderer.
  handle("resourcePacks:addFromPicker", async (event, { profileId }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Resource packs", extensions: ["zip"] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0)
      return { added: 0, existing: 0, failed: [] };
    return getService().addPacks(picked.filePaths, profileId);
  });
  handle("resourcePacks:addFiles", (_e, { paths, profileId }) =>
    getService().addPacks(Array.isArray(paths) ? paths : [], profileId),
  );

  handle("resourcePacks:remove", (_e, { sha1, force }) =>
    getService().removePack(sha1, force),
  );
  handle("resourcePacks:removeUnused", () => getService().removeUnusedPacks());

  handle("resourcePacks:search", (_e, { query, profileId, offset }) =>
    getService().searchPacks(query, profileId, offset),
  );
  handle("resourcePacks:install", (_e, { sourceId, projectId, profileId }) =>
    getService().installPack(sourceId, projectId, profileId),
  );
  handle("resourcePacks:cancelInstall", (_e, projectId) =>
    getService().cancelPackInstall(projectId),
  );
}
