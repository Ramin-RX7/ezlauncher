import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { getService } from "../services/current";
import { handle } from "./register";

export function registerDataPacksIpc(): void {
  handle("dataPacks:library", () => getService().dataPackLibrary());
  handle("dataPacks:icon", (_e, sha1) => getService().dataPackIcon(sha1));
  handle("dataPacks:folderIcon", (_e, worldId, name) =>
    getService().dataPackFolderIcon(worldId, name),
  );
  handle("dataPacks:world", (_e, worldId) =>
    getService().worldDataPacks(worldId),
  );
  handle("dataPacks:setInWorld", (_e, { worldId, sha1, present }) =>
    getService().setDataPackInWorld(worldId, sha1, present),
  );
  handle("dataPacks:worlds", (_e, sha1) => getService().dataPackWorlds(sha1));
  handle("dataPacks:addToWorlds", (_e, { sha1, worldIds }) =>
    getService().addDataPackToWorlds(sha1, worldIds),
  );

  // The dialog runs here, so these paths never come from the renderer.
  handle("dataPacks:addFromPicker", async (event, { worldId }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Data packs", extensions: ["zip"] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0)
      return { added: 0, existing: 0, failed: [] };
    return getService().addDataPacks(picked.filePaths, worldId);
  });
  handle("dataPacks:addFiles", (_e, { paths, worldId }) =>
    getService().addDataPacks(Array.isArray(paths) ? paths : [], worldId),
  );

  handle("dataPacks:remove", (_e, { sha1, force }) =>
    getService().removeDataPack(sha1, force),
  );
  handle("dataPacks:removeUnused", () => getService().removeUnusedDataPacks());

  handle("dataPacks:search", (_e, { query, worldId, offset }) =>
    getService().searchDataPacks(query, worldId, offset),
  );
  handle("dataPacks:install", (_e, { sourceId, projectId, worldId }) =>
    getService().installDataPack(sourceId, projectId, worldId),
  );
  handle("dataPacks:cancelInstall", (_e, projectId) =>
    getService().cancelDataPackInstall(projectId),
  );
  handle("dataPacks:openFolder", (_e, worldId) =>
    getService().openWorldDataPacksFolder(worldId),
  );
}
