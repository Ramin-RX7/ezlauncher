import { useSyncExternalStore } from "react";
import type {
  GameExitEvent,
  GameLogEvent,
  InstallProgress,
  InstallStateEvent,
  RunningGame,
} from "@shared/launcher";

export const MAX_LOG_LINES = 5000;
/** Closed games whose log is kept (running ones always are). */
export const MAX_CLOSED_GAMES = 5;

/** One game's output, kept separately from the others. */
export interface GameEntry {
  launchId: string;
  profileId: string;
  /** Empty until `game:started` arrives (output can come first). */
  accountId: string;
  lines: string[];
  exit?: { code: number | null; crashed: boolean };
}

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
  /** Oldest first. */
  games: GameEntry[];
  lastExit?: GameExitEvent;
}

/**
 * App-wide state fed by main-process events (installs, running games, game log).
 * A tiny store on `useSyncExternalStore`, so any component can read it.
 */
function createLauncherStore() {
  let state: LauncherState = { installs: {}, running: [], games: [] };
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
      const known = state.games.some((g) => g.launchId === game.launchId);
      set({
        ...state,
        running: [
          ...state.running.filter((g) => g.launchId !== game.launchId),
          game,
        ],
        games: known
          ? state.games.map((g) =>
              g.launchId === game.launchId
                ? { ...g, accountId: game.accountId }
                : g,
            )
          : [
              ...state.games,
              {
                launchId: game.launchId,
                profileId: game.profileId,
                accountId: game.accountId,
                lines: [],
              },
            ],
      });
    },
    gameLog(e: GameLogEvent) {
      const entry = state.games.find((g) => g.launchId === e.launchId) ?? {
        launchId: e.launchId,
        profileId: e.profileId,
        accountId: "",
        lines: [],
      };
      const all = [...entry.lines, ...e.lines];
      const next = {
        ...entry,
        lines: all.length > MAX_LOG_LINES ? all.slice(-MAX_LOG_LINES) : all,
      };
      set({
        ...state,
        games: state.games.some((g) => g.launchId === e.launchId)
          ? state.games.map((g) => (g.launchId === e.launchId ? next : g))
          : [...state.games, next],
      });
    },
    gameExit(e: GameExitEvent) {
      const games = state.games.map((g) =>
        g.launchId === e.launchId
          ? { ...g, exit: { code: e.code, crashed: e.crashed } }
          : g,
      );
      // Keep only the newest closed games.
      const closed = games.filter((g) => g.exit);
      const drop = new Set(
        closed
          .slice(0, Math.max(0, closed.length - MAX_CLOSED_GAMES))
          .map((g) => g.launchId),
      );
      set({
        ...state,
        running: state.running.filter((g) => g.launchId !== e.launchId),
        games: games.filter((g) => !drop.has(g.launchId)),
        lastExit: e,
      });
    },
    setRunning(running: RunningGame[]) {
      set({ ...state, running });
    },
    /** Forget the closed games' logs; running games keep theirs. */
    clearClosed() {
      set({ ...state, games: state.games.filter((g) => !g.exit) });
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
