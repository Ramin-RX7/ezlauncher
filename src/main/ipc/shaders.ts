import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { getService } from "../services/current";
import { handle } from "./register";

export function registerShadersIpc(): void {
  handle("shaders:library", () => getService().shaderLibrary());
  handle("shaders:icon", (_e, sha1) => getService().shaderIcon(sha1));
  handle("shaders:profile", (_e, profileId) =>
    getService().profileShaders(profileId),
  );
  handle("shaders:setActive", (_e, { profileId, shader }) =>
    getService().setActiveShader(profileId, shader),
  );
  handle("shaders:setInProfile", (_e, { profileId, sha1, present }) =>
    getService().setShaderInProfile(profileId, sha1, present),
  );

  // The dialog runs here, so these paths never come from the renderer.
  handle("shaders:addFromPicker", async (event, { profileId }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Shader packs", extensions: ["zip"] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0)
      return { added: 0, existing: 0, failed: [] };
    return getService().addShaders(picked.filePaths, profileId);
  });
  handle("shaders:addFiles", (_e, { paths, profileId }) =>
    getService().addShaders(Array.isArray(paths) ? paths : [], profileId),
  );

  handle("shaders:remove", (_e, { sha1, force }) =>
    getService().removeShader(sha1, force),
  );
  handle("shaders:removeUnused", () => getService().removeUnusedShaders());

  handle("shaders:search", (_e, { query, profileId, offset }) =>
    getService().searchShaders(query, profileId, offset),
  );
  handle("shaders:install", (_e, { sourceId, projectId, profileId }) =>
    getService().installShader(sourceId, projectId, profileId),
  );
  handle("shaders:cancelInstall", (_e, projectId) =>
    getService().cancelShaderInstall(projectId),
  );
}
