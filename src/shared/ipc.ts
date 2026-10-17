/**
 * The single IPC contract between the main process and the renderer.
 * Every channel is named here and nowhere else.
 */

import type {
  AccountInfo,
  ActivePackRef,
  AddPacksResult,
  LibraryPack,
  PackDownloadProgress,
  PackInstallResult,
  PackRef,
  PackSearchResult,
  ProfilePacks,
  ProfileShaders,
  ShaderInstallResult,
  AddToWorldsResult,
  DataPackInstallResult,
  DataPackWorld,
  WorldDataPacks,
  ModpackExportOptions,
  ModpackExportResult,
  ModpackPreview,
  ModpackProgress,
  ModpackUpdatePlan,
  ModpackUpdateResult,
  ModpackVersion,
  ApplyModsResult,
  BackupProgress,
  BackupResult,
  BackupStateEvent,
  BackupSummary,
  WorldBackup,
  BulkDownloadResult,
  GameExitEvent,
  GameLogEvent,
  InstallProgress,
  JavaInstallProgress,
  JavaListResult,
  PatchNotes,
  AddModsResult,
  DeleteWorldsChoice,
  DisablePlan,
  LaunchResult,
  LibraryMod,
  MoveProgress,
  ModBulkProgress,
  ModDownloadProgress,
  RemoteMatchCard,
  InstallStateEvent,
  InstalledVersionInfo,
  LauncherSettings,
  LaunchRequest,
  LoaderInfo,
  LoaderBuildInfo,
  OrphanWorld,
  PlayHistory,
  PlayTargets,
  SavedServerList,
  StorageReport,
  CleanupId,
  CleanupResult,
  Profile,
  ProfileInfo,
  ProfileInput,
  WorldInfo,
  RunningGame,
  SetupState,
  ValidationReport,
  VersionListResult,
} from "./launcher";
import type { UpdatePrefs, UpdateState } from "./updates";

export interface AppInfo {
  /** The user-facing application name, from `APP_DISPLAY_NAME`. */
  appName: string;
  version: string;
  /** `process.platform` of the main process, e.g. `win32`, `linux`, `darwin`. */
  platform: string;
  arch: string;
  electron: string;
  node: string;
  /** The computer's total memory, for the memory setting. */
  totalMemoryMb: number;
  /** Desktop shortcuts to profiles can be made (Windows, the Linux AppImage). */
  canCreateShortcuts: boolean;
}

/** Renderer → main request/response calls (`ipcRenderer.invoke`). `void` = returns nothing. */
/* eslint-disable @typescript-eslint/no-invalid-void-type */
export interface IpcInvokeContract {
  "app:getInfo": { args: []; result: AppInfo };

  /** Launcher updates (app-level, also before a data folder is chosen). */
  "updates:state": { args: []; result: UpdateState };
  /** Check the feed now. Resolves to the new state (an error state when it failed). */
  "updates:check": { args: []; result: UpdateState };
  /** Download the available update; progress comes as `updates:state`. */
  "updates:download": { args: []; result: void };
  "updates:cancel": { args: []; result: void };
  /** Install the downloaded update and quit; with `restart` the new version starts. */
  "updates:install": { args: [options: { restart: boolean }]; result: void };
  "updates:getPrefs": { args: []; result: UpdatePrefs };
  "updates:setPrefs": { args: [prefs: UpdatePrefs]; result: UpdatePrefs };

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
  /** Mojang's patch notes (changelog) for a Minecraft version; null when it has none. */
  "versions:patchNotes": {
    args: [versionId: string];
    result: PatchNotes | null;
  };
  "versions:delete": {
    args: [options: { versionId: string; force: boolean }];
    result: void;
  };

  "profiles:list": { args: []; result: ProfileInfo[] };
  "profiles:create": { args: [input: ProfileInput]; result: Profile };
  /** Copies settings and enabled mods; `copyWorlds` also copies its worlds (the copies belong to the new profile). */
  "profiles:duplicate": {
    args: [id: string, options?: { copyWorlds?: boolean }];
    result: Profile;
  };
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
    args: [
      id: string,
      folder?: "game" | "mods" | "resourcepacks" | "shaderpacks",
    ];
    result: void;
  };

  /** A profile's own picture (a mod pack's icon) as a `data:` URL, or null. */
  "profiles:icon": { args: [id: string]; result: string | null };

  /** Opens a file picker for a `.mrpack`; null when cancelled. */
  "modpacks:pickFile": { args: []; result: ModpackPreview | null };
  /** Reads a dropped `.mrpack` by path. */
  "modpacks:inspectFile": { args: [path: string]; result: ModpackPreview };
  /** Mod packs on the site (every loader; `loaders` says which), 20 at a time. */
  "modpacks:search": {
    args: [options: { query: string; offset: number }];
    result: PackSearchResult;
  };
  /** A pack's versions on its site, newest first. */
  "modpacks:versions": {
    args: [options: { sourceId: string; projectId: string }];
    result: ModpackVersion[];
  };
  /** Downloads a pack version and reads it; progress on `modpacks:progress` (token = version id). */
  "modpacks:inspectRemote": {
    args: [options: { sourceId: string; projectId: string; versionId: string }];
    result: ModpackPreview;
  };
  /** Imports a read pack as a new profile; `skip` = optional files left out. */
  "modpacks:import": {
    args: [options: { token: string; name: string; skip: string[] }];
    result: Profile;
  };
  /** Stops a download, import or update (by token, or version id while fetching). */
  "modpacks:cancel": { args: [token: string]; result: boolean };
  /** Puts away a read pack that wasn't imported. */
  "modpacks:discard": { args: [token: string]; result: void };
  /** The versions a pack profile can be updated to. */
  "modpacks:updateVersions": {
    args: [profileId: string];
    result: ModpackVersion[];
  };
  /** Works out an update (to a site version, or a picked file's token); changes nothing. */
  "modpacks:planUpdate": {
    args: [options: { profileId: string; versionId?: string; token?: string }];
    result: ModpackUpdatePlan;
  };
  /** Carries out a planned update; `replace` = files changed by the user to replace anyway. */
  "modpacks:applyUpdate": {
    args: [options: { token: string; replace: string[] }];
    result: ModpackUpdateResult;
  };
  "modpacks:discardUpdate": { args: [token: string]; result: void };
  "modpacks:exportOptions": {
    args: [profileId: string];
    result: ModpackExportOptions;
  };
  /** Asks where to save, then writes the profile as a `.mrpack`; null when cancelled. */
  "modpacks:export": {
    args: [
      options: {
        profileId: string;
        name: string;
        versionNumber: string;
        summary?: string;
        include: string[];
      },
    ];
    result: ModpackExportResult | null;
  };

  "worlds:list": { args: [profileId: string]; result: WorldInfo[] };
  /** Whether worlds can be started into, and the game's server list (read only). */
  "profiles:playTargets": { args: [profileId: string]; result: PlayTargets };
  /** How long a profile was played, and its sessions. */
  "profiles:playHistory": { args: [profileId: string]; result: PlayHistory };
  /** The game's server list of a profile, for editing. */
  "servers:list": { args: [profileId: string]; result: SavedServerList };
  /** The data folder's size by part, and what each clean-up would free (progress on `storage:progress`). */
  "storage:scan": { args: []; result: StorageReport };
  /** Runs the chosen clean-ups, each planned again first. */
  "storage:clean": { args: [ids: CleanupId[]]; result: CleanupResult };
  /** Saves the visible servers in this order (`key` = an existing one). Refused while it plays. */
  "servers:save": {
    args: [
      options: {
        profileId: string;
        servers: {
          key?: number;
          name: string;
          address: string;
          resourcePacks: "prompt" | "enabled" | "disabled";
        }[];
      },
    ];
    result: void;
  };
  /** Makes a desktop shortcut that opens the launcher on this profile; resolves to its path. */
  "profiles:createShortcut": {
    args: [
      options: { profileId: string; iconPng?: Uint8Array; description: string },
    ];
    result: string;
  };
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
  /** A loader's builds for a Minecraft version, newest first (asks the loader's server). */
  "loaders:builds": {
    args: [options: { loaderId: string; gameVersion: string }];
    result: LoaderBuildInfo[];
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
  /** Downloads the compatible version of every sourced library mod for a target. */
  "mods:downloadForVersion": {
    args: [options: { gameVersion: string; loaderId: string }];
    result: BulkDownloadResult;
  };
  /** Re-fetches a profile's sourced mods for its current version; disables the rest. */
  "mods:applyForProfile": {
    args: [profileId: string];
    result: ApplyModsResult;
  };
  /** Cancels an in-flight bulk download. */
  "mods:cancelBulk": { args: []; result: void };

  /** Every library resource pack (runs pack sync first). */
  "resourcePacks:library": { args: []; result: LibraryPack[] };
  /** A library pack's icon as a `data:` URL, or null. */
  "resourcePacks:icon": { args: [sha1: string]; result: string | null };
  /** A folder pack's icon (in a profile's `resourcepacks/`), or null. */
  "resourcePacks:folderIcon": {
    args: [profileId: string, name: string];
    result: string | null;
  };
  /** A profile's active packs (in order), the others it could use, and non-pack files. */
  "resourcePacks:profile": { args: [profileId: string]; result: ProfilePacks };
  /** Saves a profile's active packs, highest priority first. Fails with `GAME_RUNNING` while it plays. */
  "resourcePacks:setActive": {
    args: [options: { profileId: string; active: ActivePackRef[] }];
    result: void;
  };
  /** Opens a file picker; the chosen zips are added (and turned on in the profile, if given). */
  "resourcePacks:addFromPicker": {
    args: [options: { profileId?: string }];
    result: AddPacksResult;
  };
  /** Adds dropped zips by path (and turns them on in the profile, if given). */
  "resourcePacks:addFiles": {
    args: [options: { paths: string[]; profileId?: string }];
    result: AddPacksResult;
  };
  /** Removes a pack from the library. Fails with `PACK_IN_USE` when profiles have it, unless `force`. */
  "resourcePacks:remove": {
    args: [options: { sha1: string; force: boolean }];
    result: void;
  };
  /** Removes every pack no profile has. Resolves to how many. */
  "resourcePacks:removeUnused": { args: []; result: number };
  /** Searches the site for packs (for the profile's Minecraft version, if given), 20 at a time. */
  "resourcePacks:search": {
    args: [options: { query: string; profileId?: string; offset: number }];
    result: PackSearchResult;
  };
  /** Downloads a pack into the library (and turns it on in the profile, if given). */
  "resourcePacks:install": {
    args: [
      options: { sourceId: string; projectId: string; profileId?: string },
    ];
    result: PackInstallResult;
  };
  "resourcePacks:cancelInstall": { args: [projectId: string]; result: boolean };

  /** Every library data pack (runs pack sync first); `usedBy` holds world ids. */
  "dataPacks:library": { args: []; result: LibraryPack[] };
  "dataPacks:icon": { args: [sha1: string]; result: string | null };
  /** A folder data pack's icon (in a world's `datapacks/`), or null. */
  "dataPacks:folderIcon": {
    args: [worldId: string, name: string];
    result: string | null;
  };
  /** A world's data packs, the library's others, and non-pack files. */
  "dataPacks:world": { args: [worldId: string]; result: WorldDataPacks };
  /** Puts a library pack in a world, or takes it out. Fails with `GAME_RUNNING` while its profile plays. */
  "dataPacks:setInWorld": {
    args: [options: { worldId: string; sha1: string; present: boolean }];
    result: void;
  };
  /** Every world, with whether it has this pack (for "Add to worlds…"). */
  "dataPacks:worlds": { args: [sha1: string]; result: DataPackWorld[] };
  /** Puts a library pack in several worlds. */
  "dataPacks:addToWorlds": {
    args: [options: { sha1: string; worldIds: string[] }];
    result: AddToWorldsResult;
  };
  /** Opens a file picker; the chosen zips are added (and put in the world, if given). */
  "dataPacks:addFromPicker": {
    args: [options: { worldId?: string }];
    result: AddPacksResult;
  };
  /** Adds dropped zips by path (and puts them in the world, if given). */
  "dataPacks:addFiles": {
    args: [options: { paths: string[]; worldId?: string }];
    result: AddPacksResult;
  };
  /** Removes a data pack from the library. Fails with `DATAPACK_IN_USE` when worlds have it, unless `force`. */
  "dataPacks:remove": {
    args: [options: { sha1: string; force: boolean }];
    result: void;
  };
  "dataPacks:removeUnused": { args: []; result: number };
  /** Searches the site for data packs (for the world's Minecraft version, if given), 20 at a time. */
  "dataPacks:search": {
    args: [options: { query: string; worldId?: string; offset: number }];
    result: PackSearchResult;
  };
  /** Downloads a data pack into the library (and puts it in the world, if given). */
  "dataPacks:install": {
    args: [options: { sourceId: string; projectId: string; worldId?: string }];
    result: DataPackInstallResult;
  };
  "dataPacks:cancelInstall": { args: [projectId: string]; result: boolean };
  "dataPacks:openFolder": { args: [worldId: string]; result: void };

  /** Every library shader pack (runs pack sync first). */
  "shaders:library": { args: []; result: LibraryPack[] };
  /** A library shader's icon (its project's, from the site) as a `data:` URL, or null. */
  "shaders:icon": { args: [sha1: string]; result: string | null };
  /** A profile's active shader, its shaders, the library's others, and whether it has Iris. */
  "shaders:profile": { args: [profileId: string]; result: ProfileShaders };
  /** Makes a shader active in a profile, or turns shaders off (`null`). Fails with `GAME_RUNNING` while it plays. */
  "shaders:setActive": {
    args: [options: { profileId: string; shader: PackRef | null }];
    result: void;
  };
  /** Puts a library shader in a profile, or takes it out. */
  "shaders:setInProfile": {
    args: [options: { profileId: string; sha1: string; present: boolean }];
    result: void;
  };
  /** Opens a file picker; the chosen zips are added (and put in the profile, if given). */
  "shaders:addFromPicker": {
    args: [options: { profileId?: string }];
    result: AddPacksResult;
  };
  /** Adds dropped zips by path (and puts them in the profile, if given). */
  "shaders:addFiles": {
    args: [options: { paths: string[]; profileId?: string }];
    result: AddPacksResult;
  };
  /** Removes a shader from the library. Fails with `SHADER_IN_USE` when profiles have it, unless `force`. */
  "shaders:remove": {
    args: [options: { sha1: string; force: boolean }];
    result: void;
  };
  /** Removes every shader no profile has. Resolves to how many. */
  "shaders:removeUnused": { args: []; result: number };
  /** Searches the site for shaders (for the profile's Minecraft version, if given), 20 at a time. */
  "shaders:search": {
    args: [options: { query: string; profileId?: string; offset: number }];
    result: PackSearchResult;
  };
  /** Downloads a shader into the library (and makes it active in the profile, if given). */
  "shaders:install": {
    args: [
      options: { sourceId: string; projectId: string; profileId?: string },
    ];
    result: ShaderInstallResult;
  };
  "shaders:cancelInstall": { args: [projectId: string]; result: boolean };

  /** Mojang Java runtimes (installed and offered) and Java found on the computer. */
  "java:list": { args: []; result: JavaListResult };
  /** Downloads a Mojang Java runtime; progress on `java:progress`. */
  "java:install": { args: [component: string]; result: void };
  "java:cancel": { args: []; result: void };
  /** Deletes a Mojang Java runtime; versions using it download it again when played. */
  "java:remove": { args: [component: string]; result: void };

  /** Backs up some (default: all) of a profile's worlds; unchanged ones are skipped. Refused while it plays. */
  "backups:create": {
    args: [options: { profileId: string; worldIds?: string[] }];
    result: BackupResult;
  };
  /** Stops the running backup job (before the start: the game still starts). */
  "backups:cancel": { args: []; result: void };
  /** A world's backups, newest first. */
  "backups:list": {
    args: [options: { profileId: string; worldId: string }];
    result: WorldBackup[];
  };
  /** Unpacks a backup as a new world of the profile; resolves to the new world's id. */
  "backups:restore": {
    args: [options: { profileId: string; worldId: string; backupId: string }];
    result: string;
  };
  "backups:delete": {
    args: [options: { profileId: string; worldId: string; backupId: string }];
    result: void;
  };
  /** Shows the backup's zip in the file manager. */
  "backups:reveal": {
    args: [options: { profileId: string; worldId: string; backupId: string }];
    result: void;
  };
  "backups:summary": { args: []; result: BackupSummary };
  /** Deletes the backups of worlds that no longer exist; resolves to how many. */
  "backups:deleteOrphans": { args: []; result: number };
  "backups:openFolder": { args: []; result: void };

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
  "mods:bulkProgress": ModBulkProgress;
  "resourcePacks:download": PackDownloadProgress;
  "shaders:download": PackDownloadProgress;
  "dataPacks:download": PackDownloadProgress;
  "modpacks:progress": ModpackProgress;
  "java:progress": JavaInstallProgress;
  "backup:progress": BackupProgress;
  "backup:state": BackupStateEvent;
  "setup:moveProgress": MoveProgress;
  /** A profile's desktop shortcut was opened while the launcher runs: show that profile. */
  "app:openProfile": { profileId: string };
  /** Files counted so far by a storage scan. */
  "storage:progress": { files: number };
  "updates:state": UpdateState;
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
  "updates:state",
  "updates:check",
  "updates:download",
  "updates:cancel",
  "updates:install",
  "updates:getPrefs",
  "updates:setPrefs",
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
  "versions:patchNotes",
  "loaders:list",
  "loaders:builds",
  "profiles:list",
  "profiles:create",
  "profiles:duplicate",
  "profiles:update",
  "profiles:delete",
  "profiles:openFolder",
  "profiles:icon",
  "modpacks:pickFile",
  "modpacks:inspectFile",
  "modpacks:search",
  "modpacks:versions",
  "modpacks:inspectRemote",
  "modpacks:import",
  "modpacks:cancel",
  "modpacks:discard",
  "modpacks:updateVersions",
  "modpacks:planUpdate",
  "modpacks:applyUpdate",
  "modpacks:discardUpdate",
  "modpacks:exportOptions",
  "modpacks:export",
  "worlds:list",
  "profiles:playTargets",
  "profiles:playHistory",
  "servers:list",
  "storage:scan",
  "storage:clean",
  "servers:save",
  "profiles:createShortcut",
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
  "mods:downloadForVersion",
  "mods:applyForProfile",
  "mods:cancelBulk",
  "resourcePacks:library",
  "resourcePacks:icon",
  "resourcePacks:folderIcon",
  "resourcePacks:profile",
  "resourcePacks:setActive",
  "resourcePacks:addFromPicker",
  "resourcePacks:addFiles",
  "resourcePacks:remove",
  "resourcePacks:removeUnused",
  "resourcePacks:search",
  "resourcePacks:install",
  "resourcePacks:cancelInstall",
  "dataPacks:library",
  "dataPacks:icon",
  "dataPacks:folderIcon",
  "dataPacks:world",
  "dataPacks:setInWorld",
  "dataPacks:worlds",
  "dataPacks:addToWorlds",
  "dataPacks:addFromPicker",
  "dataPacks:addFiles",
  "dataPacks:remove",
  "dataPacks:removeUnused",
  "dataPacks:search",
  "dataPacks:install",
  "dataPacks:cancelInstall",
  "dataPacks:openFolder",
  "shaders:library",
  "shaders:icon",
  "shaders:profile",
  "shaders:setActive",
  "shaders:setInProfile",
  "shaders:addFromPicker",
  "shaders:addFiles",
  "shaders:remove",
  "shaders:removeUnused",
  "shaders:search",
  "shaders:install",
  "shaders:cancelInstall",
  "java:list",
  "backups:create",
  "backups:cancel",
  "backups:list",
  "backups:restore",
  "backups:delete",
  "backups:reveal",
  "backups:summary",
  "backups:deleteOrphans",
  "backups:openFolder",
  "java:install",
  "java:cancel",
  "java:remove",
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
  "mods:bulkProgress",
  "resourcePacks:download",
  "shaders:download",
  "dataPacks:download",
  "modpacks:progress",
  "java:progress",
  "backup:progress",
  "backup:state",
  "setup:moveProgress",
  "app:openProfile",
  "storage:progress",
  "updates:state",
] as const satisfies readonly EventChannel[];

/** Errors cross the IPC boundary in this shape. */
export interface IpcError {
  code: string;
  message: string;
}

export type IpcResponse<T> =
  { ok: true; value: T } | { ok: false; error: IpcError };
