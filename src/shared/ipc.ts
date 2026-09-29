/**
 * The single IPC contract between the main process and the renderer.
 * Every channel is named here and nowhere else.
 */

import type {
  AccountInfo,
  GameExitEvent,
  GameLogEvent,
  InstallProgress,
  AddModsResult,
  DeleteWorldsChoice,
  DisablePlan,
  LaunchResult,
  LibraryMod,
  MoveProgress,
  ModDownloadProgress,
  RemoteMatchCard,
  InstallStateEvent,
  InstalledVersionInfo,
  LauncherSettings,
  LaunchRequest,
  LoaderInfo,
  OrphanWorld,
  Profile,
  ProfileInfo,
  ProfileInput,
  WorldInfo,
  RunningGame,
  SetupState,
  ValidationReport,
  VersionListResult,
} from "./launcher";

export interface AppInfo {
  version: string;
  /** `process.platform` of the main process, e.g. `win32`, `linux`, `darwin`. */
  platform: string;
  arch: string;
  electron: string;
  node: string;
  /** The computer's total memory, for the memory setting. */
  totalMemoryMb: number;
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
  /**
   * Moves the data folder to `dir` (an empty folder), then restarts. Progress comes as
   * `setup:moveProgress`. Fails with `GAME_RUNNING` / `BUSY` while things are running.
   */
  "setup:moveDataDir": { args: [dir: string]; result: void };
  "setup:cancelMove": { args: []; result: void };

  "versions:list": {
    args: [options: { refresh?: boolean }];
    result: VersionListResult;
  };
  /** Resolves when the install finishes; progress arrives as `install:*` events. */
  "versions:install": { args: [versionId: string]; result: void };
  "versions:cancel": { args: [versionId: string]; result: boolean };
  "versions:repair": { args: [versionId: string]; result: void };
  /** Installed versions with the profiles that use them. */
  "versions:installed": { args: []; result: InstalledVersionInfo[] };
  /**
   * Deletes the version (and the installs built on it). Fails with `VERSION_IN_USE`
   * when profiles use it or others build on it, unless `force`.
   */
  "versions:delete": {
    args: [options: { versionId: string; force: boolean }];
    result: void;
  };

  "profiles:list": { args: []; result: ProfileInfo[] };
  "profiles:create": { args: [input: ProfileInput]; result: Profile };
  "profiles:update": {
    args: [id: string, patch: Partial<ProfileInput>];
    result: Profile;
  };
  "profiles:delete": {
    args: [options: { id: string; worlds: DeleteWorldsChoice }];
    result: void;
  };
  /** Opens the profile's game folder, or its `mods/` (created if missing). */
  "profiles:openFolder": {
    args: [id: string, folder?: "game" | "mods"];
    result: void;
  };

  "worlds:list": { args: [profileId: string]; result: WorldInfo[] };
  "worlds:move": {
    args: [options: { worldId: string; toProfileId: string }];
    result: void;
  };
  /** Worlds whose profile is gone; the user assigns them with `worlds:move`. */
  "worlds:orphans": { args: []; result: OrphanWorld[] };
  "worlds:openFolder": {
    args: [options: { profileId: string; worldId: string }];
    result: void;
  };

  /** Mod loaders and the Minecraft versions each supports (cached; `refresh` asks the servers). */
  "loaders:list": {
    args: [options: { refresh?: boolean }];
    result: LoaderInfo[];
  };

  /** Every library mod; with `profileId`, also its state and compatibility there. Runs mod sync first. */
  "mods:library": {
    args: [options: { profileId?: string }];
    result: LibraryMod[];
  };
  /** The mod's icon as a `data:` URL, or null. */
  "mods:icon": { args: [sha1: string]; result: string | null };
  /** Opens a file picker; the chosen jars are added (and enabled in the profile, if given). */
  "mods:addFromPicker": {
    args: [options: { profileId?: string }];
    result: AddModsResult;
  };
  /** Adds dropped jar files by path (and enables them in the profile, if given). */
  "mods:addFiles": {
    args: [options: { paths: string[]; profileId?: string }];
    result: AddModsResult;
  };
  /**
   * Ticks or unticks a mod. Unticking fails with `MOD_REQUIRED` while another enabled mod
   * needs it, and also disables the dependencies nothing else needs (`disabled`).
   */
  "mods:setEnabled": {
    args: [options: { profileId: string; sha1: string; enabled: boolean }];
    result: { disabled: string[] };
  };
  /** Removes a mod from the library. Fails with `MOD_IN_USE` when profiles use it, unless `force`. */
  "mods:remove": {
    args: [options: { sha1: string; force: boolean }];
    result: void;
  };
  /** Removes every mod no profile uses. Resolves to how many were removed. */
  "mods:removeUnused": { args: []; result: number };
  /** Exact-name search on the mod sites, for a profile. One card per exact match. */
  "mods:findRemote": {
    args: [options: { profileId: string; query: string }];
    result: RemoteMatchCard[];
  };
  /** Downloads a card's mod and dependencies into the library and enables them. */
  /** Resolves to other enabled mods that were replaced (same mod id) and not on the card. */
  "mods:installRemote": {
    args: [planId: string];
    result: { replaced: string[] };
  };
  "mods:cancelRemote": { args: [planId: string]; result: boolean };
  /** Checks the profile's enabled mods; `full` also hashes every file (Check mods). */
  "mods:validate": {
    args: [options: { profileId: string; full?: boolean }];
    result: ValidationReport;
  };
  /** The mods "Disable problem mods and play" would disable. */
  "mods:disablePlan": { args: [profileId: string]; result: DisablePlan };
  /** Downloads a damaged mod again from its site. Fails with `MOD_NO_SOURCE` without one. */
  "mods:redownload": { args: [sha1: string]; result: void };

  "account:list": { args: []; result: AccountInfo[] };
  /** Fails with `ACCOUNT_NAME_TAKEN` when another account has the name (ignoring case). */
  "account:add": { args: [username: string]; result: AccountInfo };
  /** Only the name changes; the UUID stays. */
  "account:rename": {
    args: [options: { id: string; username: string }];
    result: AccountInfo;
  };
  /** Removes the account from the launcher; world files are not touched. */
  "account:remove": { args: [id: string]; result: void };

  "settings:get": { args: []; result: LauncherSettings };
  "settings:update": {
    args: [patch: Partial<LauncherSettings>];
    result: LauncherSettings;
  };

  /**
   * Installs or checks the profile's version, syncs its worlds, checks its mods, then
   * starts it. With mod errors (and `problems: "check"`) it starts nothing: `blocked`.
   */
  "game:launch": { args: [request: LaunchRequest]; result: LaunchResult };
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
  /** Profiles, their worlds or running counts changed; refetch. */
  "profiles:changed": Record<string, never>;
  "mods:download": ModDownloadProgress;
  "setup:moveProgress": MoveProgress;
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
  "setup:moveDataDir",
  "setup:cancelMove",
  "versions:list",
  "versions:install",
  "versions:cancel",
  "versions:repair",
  "versions:installed",
  "versions:delete",
  "loaders:list",
  "profiles:list",
  "profiles:create",
  "profiles:update",
  "profiles:delete",
  "profiles:openFolder",
  "worlds:list",
  "worlds:move",
  "worlds:orphans",
  "worlds:openFolder",
  "mods:library",
  "mods:icon",
  "mods:addFromPicker",
  "mods:addFiles",
  "mods:setEnabled",
  "mods:remove",
  "mods:removeUnused",
  "mods:findRemote",
  "mods:installRemote",
  "mods:cancelRemote",
  "mods:validate",
  "mods:disablePlan",
  "mods:redownload",
  "account:list",
  "account:add",
  "account:rename",
  "account:remove",
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
  "profiles:changed",
  "mods:download",
  "setup:moveProgress",
] as const satisfies readonly EventChannel[];

/** Errors cross the IPC boundary in this shape. */
export interface IpcError {
  code: string;
  message: string;
}

export type IpcResponse<T> =
  { ok: true; value: T } | { ok: false; error: IpcError };
