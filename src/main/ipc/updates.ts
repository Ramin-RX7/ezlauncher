import { app } from "electron";
import { getUpdates } from "../services/updates";
import { handle } from "./register";

export function registerUpdatesIpc(): void {
  handle("updates:state", () => getUpdates().getState());
  handle("updates:check", () => getUpdates().check({ manual: true }));
  handle("updates:download", () => getUpdates().download());
  handle("updates:cancel", () => {
    getUpdates().cancel();
  });
  handle("updates:install", async (_e, { restart }) => {
    await getUpdates().install({ restart });
    // Answer the renderer first, then quit (the new version waits for this process).
    setTimeout(() => {
      app.quit();
    }, 100);
  });
  handle("updates:getPrefs", () => getUpdates().getPrefs());
  handle("updates:setPrefs", (_e, prefs) =>
    getUpdates().setPrefs({ autoCheck: prefs.autoCheck }),
  );
}
