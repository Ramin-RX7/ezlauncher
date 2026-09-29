import { useSyncExternalStore } from "react";
import type {
  GameExitEvent,
  InstallProgress,
  InstallStateEvent,
  RunningGame,
} from "@shared/launcher";

export const MAX_LOG_LINES = 5000;

export interface InstallEntry {
  status: InstallStateEvent["status"];
  progress?: InstallProgress;
  error?: InstallStateEvent["error"];
}

export interface LauncherState {
  installs: Record<string, InstallEntry>;
  /** The install that most recently started or was queued (a new loader install's id is only known then). */
  latestInstallId?: string;
  running: RunningGame[];
  log: string[];
  lastExit?: GameExitEvent;
}

/**
 * App-wide state fed by main-process events (installs, running games, game log).
 * A tiny store on `useSyncExternalStore`, so any component can read it.
 */
function createLauncherStore() {
  let state: LauncherState = { installs: {}, running: [], log: [] };
  const listeners = new Set<() => void>();
  const set = (next: LauncherState) => {
    state = next;
    for (const l of listeners) l();
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    installState(e: InstallStateEvent) {
      const prev = state.installs[e.versionId];
      const entry: InstallEntry = {
        status: e.status,
        ...(e.status === "running" &&
          prev?.progress && { progress: prev.progress }),
        ...(e.error && { error: e.error }),
      };
      const started = e.status === "queued" || e.status === "running";
      set({
        ...state,
        installs: { ...state.installs, [e.versionId]: entry },
        ...(started && { latestInstallId: e.versionId }),
      });
    },
    installProgress(p: InstallProgress) {
      const prev = state.installs[p.versionId];
      set({
        ...state,
        installs: {
          ...state.installs,
          [p.versionId]: { status: prev?.status ?? "running", progress: p },
        },
      });
    },
    gameStarted(game: RunningGame) {
      set({
        ...state,
        running: [
          ...state.running.filter((g) => g.launchId !== game.launchId),
          game,
        ],
      });
    },
    gameLog(lines: string[]) {
      const log = [...state.log, ...lines];
      set({
        ...state,
        log: log.length > MAX_LOG_LINES ? log.slice(-MAX_LOG_LINES) : log,
      });
    },
    gameExit(e: GameExitEvent) {
      set({
        ...state,
        running: state.running.filter((g) => g.launchId !== e.launchId),
        lastExit: e,
      });
    },
    setRunning(running: RunningGame[]) {
      set({ ...state, running });
    },
    clearLog() {
      set({ ...state, log: [] });
    },
    dismissExit() {
      const next = { ...state };
      delete next.lastExit;
      set(next);
    },
  };
}

export const launcherStore = createLauncherStore();

export function useLauncherState<T>(select: (s: LauncherState) => T): T {
  return useSyncExternalStore(launcherStore.subscribe, () =>
    select(launcherStore.getState()),
  );
}
