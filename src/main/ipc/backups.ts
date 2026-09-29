import { getService } from "../services/current";
import { handle } from "./register";

export function registerBackupsIpc(): void {
  handle("backups:create", (_e, { profileId, worldIds }) =>
    getService().backupWorlds(profileId, worldIds),
  );
  handle("backups:cancel", () => {
    getService().cancelBackup();
  });
  handle("backups:list", (_e, { profileId, worldId }) =>
    getService().listWorldBackups(profileId, worldId),
  );
  handle("backups:restore", (_e, { profileId, worldId, backupId }) =>
    getService().restoreWorldBackup(profileId, worldId, backupId),
  );
  handle("backups:delete", (_e, { profileId, worldId, backupId }) =>
    getService().deleteWorldBackup(profileId, worldId, backupId),
  );
  handle("backups:reveal", (_e, { profileId, worldId, backupId }) =>
    getService().revealWorldBackup(profileId, worldId, backupId),
  );
  handle("backups:summary", () => getService().backupSummary());
  handle("backups:deleteOrphans", () => getService().deleteOrphanBackups());
  handle("backups:openFolder", () => getService().openBackupsFolder());
}
