import { getService } from "../services/current";
import { handle } from "./register";

export function registerStorageIpc(): void {
  handle("storage:scan", () => getService().storageScan());
  handle("storage:clean", (_e, ids) => getService().storageClean(ids));
}
