import { registerAppIpc } from "./app";
import { registerBackupsIpc } from "./backups";
import { registerDataPacksIpc } from "./dataPacks";
import { registerJavaIpc } from "./java";
import { registerLauncherIpc } from "./launcher";
import { registerModpacksIpc } from "./modpacks";
import { registerModsIpc } from "./mods";
import { registerProfilesIpc } from "./profiles";
import { registerResourcePacksIpc } from "./resourcePacks";
import { registerSetupIpc } from "./setup";
import { registerShadersIpc } from "./shaders";
import { registerStorageIpc } from "./storage";
import { registerUpdatesIpc } from "./updates";

/** Register every IPC handler. Each feature adds its own `register…Ipc()` here. */
export function registerIpc(): void {
  registerAppIpc();
  registerSetupIpc();
  registerLauncherIpc();
  registerProfilesIpc();
  registerModsIpc();
  registerResourcePacksIpc();
  registerShadersIpc();
  registerDataPacksIpc();
  registerModpacksIpc();
  registerJavaIpc();
  registerBackupsIpc();
  registerStorageIpc();
  registerUpdatesIpc();
}
