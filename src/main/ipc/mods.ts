import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { getService } from "../services/current";
import { handle } from "./register";

export function registerModsIpc(): void {
  handle("mods:library", (_e, { profileId }) =>
    getService().modLibrary(profileId),
  );
  handle("mods:icon", (_e, sha1) => getService().modIcon(sha1));

  // The dialog runs here, so these paths never come from the renderer.
  handle("mods:addFromPicker", async (event, { profileId }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Minecraft mods", extensions: ["jar"] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0)
      return { added: 0, existing: 0, failed: [] };
    return getService().addMods(picked.filePaths, profileId);
  });
  handle("mods:addFiles", (_e, { paths, profileId }) =>
    getService().addMods(Array.isArray(paths) ? paths : [], profileId),
  );

  handle("mods:setEnabled", (_e, { profileId, sha1, enabled }) =>
    getService().setModEnabled(profileId, sha1, enabled),
  );
  handle("mods:remove", (_e, { sha1, force }) =>
    getService().removeMod(sha1, force),
  );
  handle("mods:removeUnused", () => getService().removeUnusedMods());

  handle("mods:findRemote", (_e, { profileId, query }) =>
    getService().findRemoteMods(profileId, query),
  );
  handle("mods:installRemote", (_e, planId) =>
    getService().installRemoteMod(planId),
  );
  handle("mods:cancelRemote", (_e, planId) =>
    getService().cancelRemoteMod(planId),
  );

  handle("mods:validate", (_e, { profileId, full }) =>
    getService().validateMods(profileId, { full: full === true }),
  );
  handle("mods:disablePlan", (_e, profileId) =>
    getService().disablePlan(profileId),
  );
  handle("mods:redownload", (_e, sha1) => getService().redownloadMod(sha1));

  handle("mods:downloadForVersion", (_e, target) =>
    getService().downloadLibraryMods(target),
  );
  handle("mods:applyForProfile", (_e, profileId) =>
    getService().applyProfileMods(profileId),
  );
  handle("mods:cancelBulk", () => {
    getService().cancelBulkDownload();
  });
}
