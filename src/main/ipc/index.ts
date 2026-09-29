import { registerAppIpc } from "./app";
import { registerLauncherIpc } from "./launcher";
import { registerModsIpc } from "./mods";
import { registerProfilesIpc } from "./profiles";
import { registerSetupIpc } from "./setup";

/** Register every IPC handler. Each feature adds its own `register…Ipc()` here. */
export function registerIpc(): void {
  registerAppIpc();
  registerSetupIpc();
  registerLauncherIpc();
  registerProfilesIpc();
  registerModsIpc();
}
