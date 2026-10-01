import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/api";
import { useIpcEvent } from "../lib/useIpcEvent";
import { launcherStore } from "./launcherStore";

/** Feeds main-process events into the launcher store. Render once, inside the app. */
export function LauncherEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    invoke("game:running")
      .then((games) => {
        launcherStore.setRunning(games);
      })
      .catch(() => undefined);
  }, []);

  useIpcEvent("install:state", (e) => {
    launcherStore.installState(e);
    if (e.status === "done") {
      void queryClient.invalidateQueries({ queryKey: ["versions"] });
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  });
  useIpcEvent("install:progress", (p) => {
    launcherStore.installProgress(p);
  });
  useIpcEvent("backup:state", (e) => {
    launcherStore.backupState(e);
    if (e.status !== "running")
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
  });
  useIpcEvent("backup:progress", (p) => {
    launcherStore.backupProgress(p);
  });
  useIpcEvent("game:started", (g) => {
    launcherStore.gameStarted(g);
  });
  useIpcEvent("game:log", (e) => {
    launcherStore.gameLog(e);
  });
  useIpcEvent("game:exit", (e) => {
    launcherStore.gameExit(e);
  });
  useIpcEvent("profiles:changed", () => {
    void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    void queryClient.invalidateQueries({ queryKey: ["worlds"] });
    void queryClient.invalidateQueries({ queryKey: ["backups"] });
    void queryClient.invalidateQueries({ queryKey: ["versions"] });
    void queryClient.invalidateQueries({ queryKey: ["mods"] });
    void queryClient.invalidateQueries({ queryKey: ["resourcePacks"] });
  });
  return null;
}
