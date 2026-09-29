import { getService } from "../services/current";
import { handle } from "./register";

export function registerLauncherIpc(): void {
  handle("versions:list", (_e, options) => getService().listVersions(options));
  handle("versions:install", (_e, id) => getService().installVersion(id));
  handle("versions:cancel", (_e, id) => getService().cancelInstall(id));
  handle("versions:repair", (_e, id) => getService().repairVersion(id));
  handle(
    "versions:delete",
    (_e, { versionId, deleteGameDir, deleteDependents }) =>
      getService().deleteVersion(versionId, deleteGameDir, deleteDependents),
  );
  handle("versions:dependents", (_e, id) => getService().dependents(id));
  handle("versions:openGameDir", (_e, id) => getService().openGameDir(id));
  handle("versions:openModsDir", (_e, id) => getService().openModsDir(id));

  handle("loaders:list", (_e, options) => getService().listLoaders(options));

  handle("account:get", () => getService().getAccount());
  handle("account:setUsername", (_e, username) =>
    getService().setUsername(username),
  );

  handle("settings:get", () => getService().getSettings());
  handle("settings:update", (_e, patch) => getService().updateSettings(patch));

  handle("game:launch", (_e, target) => getService().launch(target));
  handle("game:running", () => getService().runningGames());
}
