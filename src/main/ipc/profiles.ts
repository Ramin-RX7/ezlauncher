import { getService } from "../services/current";
import { handle } from "./register";

export function registerProfilesIpc(): void {
  handle("profiles:list", () => getService().listProfiles());
  handle("profiles:create", (_e, input) => getService().createProfile(input));
  handle("profiles:duplicate", (_e, id, options) =>
    getService().duplicateProfile(id, {
      copyWorlds: options?.copyWorlds === true,
    }),
  );
  handle("profiles:update", (_e, id, patch) =>
    getService().updateProfile(id, patch),
  );
  handle("profiles:delete", (_e, { id, worlds }) =>
    getService().deleteProfile(id, worlds),
  );
  handle("profiles:openFolder", (_e, id, folder) =>
    getService().openProfileFolder(
      id,
      folder === "mods" ||
        folder === "resourcepacks" ||
        folder === "shaderpacks"
        ? folder
        : "game",
    ),
  );

  handle("worlds:list", (_e, profileId) => getService().listWorlds(profileId));
  handle("profiles:createShortcut", (_e, { profileId, iconPng, description }) =>
    getService().createShortcut(profileId, { iconPng, description }),
  );
  handle("servers:list", (_e, profileId) => getService().serverList(profileId));
  handle("servers:save", (_e, { profileId, servers }) =>
    getService().saveServerList(profileId, servers),
  );
  handle("profiles:playHistory", (_e, profileId) =>
    getService().playHistory(profileId),
  );
  handle("profiles:playTargets", (_e, profileId) =>
    getService().playTargets(profileId),
  );
  handle("worlds:move", (_e, { worldId, toProfileId }) =>
    getService().moveWorld(worldId, toProfileId),
  );
  handle("worlds:orphans", () => getService().listOrphanWorlds());
  handle("worlds:openFolder", (_e, { profileId, worldId }) =>
    getService().openWorldFolder(profileId, worldId),
  );
}
