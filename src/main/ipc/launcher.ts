import { getService } from "../services/current";
import { handle } from "./register";

export function registerLauncherIpc(): void {
  handle("versions:list", (_e, options) => getService().listVersions(options));
  handle("versions:install", (_e, id) => getService().installVersion(id));
  handle("versions:cancel", (_e, id) => getService().cancelInstall(id));
  handle("versions:repair", (_e, id) => getService().repairVersion(id));
  handle("versions:delete", (_e, { versionId, deleteGameDir }) =>
    getService().deleteVersion(versionId, deleteGameDir),
  );
  handle("versions:openGameDir", (_e, id) => getService().openGameDir(id));

  handle("account:get", () => getService().getAccount());
  handle("account:setUsername", (_e, username) =>
    getService().setUsername(username),
  );

  handle("settings:get", () => getService().getSettings());
  handle("settings:update", (_e, patch) => getService().updateSettings(patch));

  handle("game:launch", (_e, id) => getService().launch(id));
  handle("game:running", () => getService().runningGames());
}
