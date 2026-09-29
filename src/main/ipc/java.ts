import { getService } from "../services/current";
import { handle } from "./register";

export function registerJavaIpc(): void {
  handle("java:list", () => getService().listJava());
  handle("java:install", (_e, component) =>
    getService().installJava(component),
  );
  handle("java:cancel", () => {
    getService().cancelJavaInstall();
  });
  handle("java:remove", (_e, component) => getService().removeJava(component));
}
