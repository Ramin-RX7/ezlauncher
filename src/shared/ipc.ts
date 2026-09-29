/**
 * The single IPC contract between the main process and the renderer.
 * Every channel is named here and nowhere else.
 */

import type {
  AccountInfo,
  GameExitEvent,
  GameLogEvent,
  InstallProgress,
  InstallStateEvent,
  LauncherSettings,
  RunningGame,
  SetupState,
  VersionListResult,
} from "./launcher";

export interface AppInfo {
  version: string;
  /** `process.platform` of the main process, e.g. `win32`, `linux`, `darwin`. */
  platform: string;
  arch: string;
  electron: string;
  node: string;
}

/** Renderer → main request/response calls (`ipcRenderer.invoke`). `void` = returns nothing. */
/* eslint-disable @typescript-eslint/no-invalid-void-type */
export interface IpcInvokeContract {
  "app:getInfo": { args: []; result: AppInfo };

  "setup:getState": { args: []; result: SetupState };
  /** Opens a folder picker. Resolves to the chosen folder, or null if cancelled. */
  "setup:chooseFolder": { args: []; result: string | null };
  /** Sets the data folder. If one was already set, the app restarts. */
  "setup:setDataDir": { args: [dir: string]; result: void };

  "versions:list": {
    args: [options: { refresh?: boolean }];
    result: VersionListResult;
  };
  /** Resolves when the install finishes; progress arrives as `install:*` events. */
  "versions:install": { args: [versionId: string]; result: void };
  "versions:cancel": { args: [versionId: string]; result: boolean };
  "versions:repair": { args: [versionId: string]; result: void };
  "versions:delete": {
    args: [options: { versionId: string; deleteGameDir: boolean }];
    result: void;
  };
  "versions:openGameDir": { args: [versionId: string]; result: void };

  "account:get": { args: []; result: AccountInfo | null };
  /** Creates the offline account, or renames it (the UUID is kept). */
  "account:setUsername": { args: [username: string]; result: AccountInfo };

  "settings:get": { args: []; result: LauncherSettings };
  "settings:update": {
    args: [patch: Partial<LauncherSettings>];
    result: LauncherSettings;
  };

  /** Installs or checks the version, then starts it. Resolves once the game has started. */
  "game:launch": { args: [versionId: string]; result: RunningGame };
  "game:running": { args: []; result: RunningGame[] };
}

/* eslint-enable @typescript-eslint/no-invalid-void-type */

/** Main → renderer push events (`webContents.send`). */
export interface IpcEventContract {
  "install:progress": InstallProgress;
  "install:state": InstallStateEvent;
  "game:started": RunningGame;
  "game:log": GameLogEvent;
  "game:exit": GameExitEvent;
}

export type InvokeChannel = keyof IpcInvokeContract;
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeContract[C]["args"];
export type InvokeResult<C extends InvokeChannel> =
  IpcInvokeContract[C]["result"];

export type EventChannel = keyof IpcEventContract;
export type EventPayload<C extends EventChannel> = IpcEventContract[C];

/** Runtime list of channels; the preload only forwards these. Must match the contract. */
export const INVOKE_CHANNELS = [
  "app:getInfo",
  "setup:getState",
  "setup:chooseFolder",
  "setup:setDataDir",
  "versions:list",
  "versions:install",
  "versions:cancel",
  "versions:repair",
  "versions:delete",
  "versions:openGameDir",
  "account:get",
  "account:setUsername",
  "settings:get",
  "settings:update",
  "game:launch",
  "game:running",
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = [
  "install:progress",
  "install:state",
  "game:started",
  "game:log",
  "game:exit",
] as const satisfies readonly EventChannel[];

/** Errors cross the IPC boundary in this shape. */
export interface IpcError {
  code: string;
  message: string;
}

export type IpcResponse<T> =
  { ok: true; value: T } | { ok: false; error: IpcError };
