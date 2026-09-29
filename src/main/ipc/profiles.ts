import { getService } from "../services/current";
import { handle } from "./register";

export function registerProfilesIpc(): void {
  handle("profiles:list", () => getService().listProfiles());
  handle("profiles:create", (_e, input) => getService().createProfile(input));
  handle("profiles:update", (_e, id, patch) =>
    getService().updateProfile(id, patch),
  );
  handle("profiles:delete", (_e, { id, worlds }) =>
    getService().deleteProfile(id, worlds),
  );
  handle("profiles:openFolder", (_e, id) => getService().openProfileFolder(id));

  handle("worlds:list", (_e, profileId) => getService().listWorlds(profileId));
  handle("worlds:move", (_e, { worldId, toProfileId }) =>
    getService().moveWorld(worldId, toProfileId),
  );
  handle("worlds:orphans", () => getService().listOrphanWorlds());
  handle("worlds:openFolder", (_e, { profileId, worldId }) =>
    getService().openWorldFolder(profileId, worldId),
  );
}
