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
    if (e.status === "done")
      void queryClient.invalidateQueries({ queryKey: ["versions"] });
  });
  useIpcEvent("install:progress", (p) => {
    launcherStore.installProgress(p);
  });
  useIpcEvent("game:started", (g) => {
    launcherStore.gameStarted(g);
  });
  useIpcEvent("game:log", (e) => {
    launcherStore.gameLog(e.lines);
  });
  useIpcEvent("game:exit", (e) => {
    launcherStore.gameExit(e);
  });
  return null;
}
