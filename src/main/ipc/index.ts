import { registerAppIpc } from "./app";

/** Register every IPC handler. Each feature adds its own `register…Ipc()` here. */
export function registerIpc(): void {
  registerAppIpc();
}
