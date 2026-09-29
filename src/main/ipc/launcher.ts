import { getService } from "../services/current";
import { handle } from "./register";

export function registerLauncherIpc(): void {
  handle("versions:list", (_e, options) => getService().listVersions(options));
  handle("versions:installed", () => getService().installedVersions());
  handle("versions:install", (_e, id) => getService().installVersion(id));
  handle("versions:cancel", (_e, id) => getService().cancelInstall(id));
  handle("versions:repair", (_e, id) => getService().repairVersion(id));
  handle("versions:patchNotes", (_e, versionId) =>
    getService().versionPatchNotes(versionId),
  );
  handle("versions:delete", (_e, { versionId, force }) =>
    getService().deleteVersion(versionId, force),
  );

  handle("loaders:list", (_e, options) => getService().listLoaders(options));

  handle("account:list", () => getService().listAccounts());
  handle("account:add", (_e, username) => getService().addAccount(username));
  handle("account:rename", (_e, { id, username }) =>
    getService().renameAccount(id, username),
  );
  handle("account:remove", (_e, id) => getService().removeAccount(id));

  handle("settings:get", () => getService().getSettings());
  handle("settings:update", (_e, patch) => getService().updateSettings(patch));

  handle("game:launch", (_e, request) => getService().launch(request));
  handle("game:running", () => getService().runningGames());
}
