/** Data shapes shared by the main process and the renderer. No Node or DOM types here. */

export type VersionType =
  "release" | "snapshot" | "old_beta" | "old_alpha" | (string & {});

/** What a mod loader install is built on. */
export interface LoaderRef {
  /** Loader provider id, e.g. `fabric`, `quilt`. */
  id: string;
  loaderVersion: string;
  /** The Minecraft version it runs on. */
  gameVersion: string;
}

export interface VersionSummary {
  id: string;
  type: VersionType;
  releaseTime: string;
  installed: boolean;
  /** Set for mod loader installs. */
  loader?: LoaderRef;
}

export interface LoaderInfo {
  id: string;
  displayName: string;
  /** Minecraft versions the loader supports; null = not known yet (offline, never fetched). */
  gameVersions: string[] | null;
}

export interface LoaderBuildInfo {
  version: string;
  /** false = a beta or pre-release build. */
  stable: boolean;
}

/** An installed version as shown on the Versions page. */
export interface InstalledVersionInfo extends VersionSummary {
  /** Ids of the profiles that play this version (directly or through a loader install). */
  usedBy: string[];
  /** Installed versions built on this one (e.g. loader installs). */
  dependents: string[];
}

/** Start straight into one of the profile's worlds, or onto a server (`host[:port]`). */
export type QuickPlay =
  { kind: "world"; worldId: string } | { kind: "server"; address: string };

/** What a profile can start straight into (before it's installed too). */
export interface PlayTargets {
  /** `needsNewer`: Minecraft before 1.20 can't start into a world. */
  worlds: "yes" | "needsNewer";
  /** The game's own server list (Multiplayer screen), read only. */
  servers: { name: string; address: string; icon?: string }[];
}

// ---- Storage ----

/** The parts of the data folder the Storage page sizes. */
export const STORAGE_CATEGORIES = [
  "versions",
  "libraries",
  "assets",
  "java",
  "mods",
  "resourcePacks",
  "shaders",
  "dataPacks",
  "worlds",
  "backups",
  "profiles",
  "launcher",
  "other",
] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export type CleanupId =
  "libraryItems" | "versions" | "java" | "gameFiles" | "backups" | "logs";

/** What a clean-up would remove, and how much it frees. */
export interface CleanupPlan {
  id: CleanupId;
  bytes: number;
  count: number;
  /** The biggest items (at most a few hundred). */
  items: { label: string; bytes: number }[];
  /** There's something to clean, and it can be cleaned now. */
  available: boolean;
  /** Why it can't run now: installs going on, or a version that can't be read. */
  reason?: "busy" | "unreadable";
}

export interface StorageReport {
  totalBytes: number;
  categories: { id: StorageCategory; bytes: number; files: number }[];
  cleanups: CleanupPlan[];
  /** ISO date. */
  scannedAt: string;
}

export interface CleanupResult {
  freedBytes: number;
  failed: { id: CleanupId; code: string }[];
}

/** A profile's server list (the game's Multiplayer list), for editing. */
export interface SavedServerList {
  servers: {
    /** Its place in the game's file; send it back with edits. */
    key: number;
    name: string;
    address: string;
    /** The game's "Server Resource Packs" choice. */
    resourcePacks: "prompt" | "enabled" | "disabled";
    icon?: string;
  }[];
  /** A game of the profile runs: it can't be changed now. */
  locked: boolean;
}

/** How long a profile was played, and its sessions (newest first). */
export interface PlayHistory {
  totalMs: number;
  sessions: {
    /** ISO date. */
    startedAt: string;
    durationMs: number;
    /** Missing when the account was removed since. */
    accountName?: string;
    quickPlay?: QuickPlay;
    /** Ended while the launcher was closed: about this long. */
    approx?: boolean;
  }[];
}

/** Every launch is a profile played by an account. */
export interface LaunchRequest {
  profileId: string;
  accountId: string;
  quickPlay?: QuickPlay;
  /**
   * What to do about mod errors: `check` (default) stops and reports them,
   * `ignore` plays anyway, `disable` disables those mods first.
   */
  problems?: "check" | "ignore" | { disable: string[] };
}

export type LaunchResult =
  | {
      status: "started";
      game: RunningGame;
      warnings: number;
      /** Worlds whose backup before the start failed (the game started anyway). */
      backupFailed?: string[];
    }
  /** Mod errors were found; nothing was started. */
  | { status: "blocked"; report: ValidationReport };

export const PROFILE_NAME_MAX = 32;

export interface Profile {
  /** Random UUID; never changes. The profile's game folder is named after it. */
  id: string;
  /** 1–32 characters. Renaming is always safe. */
  name: string;
  gameVersion: string;
  /** null = Vanilla. No `version` = the latest stable build at install time. */
  loader: ProfileLoader | null;
  /** A built-in profile icon id (renderer asset). Missing = the default icon. */
  iconId?: string;
  /** Its own picture (a mod pack's icon), shown instead of `iconId`. */
  customIcon?: boolean;
  /** Made from this mod pack (see `modpacks:*`). */
  modpack?: ProfileModpack;
  /** The version actually installed for this profile, e.g. `fabric-loader-0.19.5-1.18.2`. */
  installedVersionId?: string;
  /** Missing = use the global setting. */
  memoryMaxMb?: number;
  /** One argument per item. Missing = use the global setting; `[]` = none. */
  extraJvmArgs?: string[];
  /** Added after the version's game arguments. Missing = use the global setting. */
  extraGameArgs?: string[];
  createdAt: string;
  lastPlayedAt?: string;
}

export interface ProfileLoader {
  id: string;
  /** A pinned loader build, e.g. `0.19.5`. */
  version?: string;
}

export interface ProfileModpack {
  name: string;
  versionNumber: string;
  /** Set when it came from a mod site, so it can be updated. */
  sourceId?: string;
  projectId?: string;
  versionId?: string;
}

/** What the user edits. `null` clears an optional value. */
export interface ProfileInput {
  name: string;
  gameVersion: string;
  loader: ProfileLoader | null;
  /** A built-in icon id, or `null` to clear it. */
  iconId?: string | null;
  memoryMaxMb?: number | null;
  extraJvmArgs?: string[] | null;
  extraGameArgs?: string[] | null;
}

export interface ProfileInfo extends Profile {
  /** How many games of this profile are running. */
  running: number;
  /** How long it was played in all (ms). */
  playTimeMs?: number;
}

export interface WorldInfo {
  /** Folder name in `worlds/` (or in the profile's `saves/` when not linked). */
  id: string;
  /** The in-game name (`LevelName`), or the folder name. */
  name: string;
  /** ISO date. */
  lastPlayed?: string;
  /** false = a real folder in the profile's `saves/` because a link couldn't be made; it can't be moved. */
  linked: boolean;
  /** When its newest backup was made (ISO date). */
  lastBackupAt?: string;
  /** How many backups it has. */
  backupCount?: number;
}

/** A world whose owner profile no longer exists. */
export interface OrphanWorld {
  id: string;
  name: string;
  lastPlayed?: string;
}

/** Why a library mod can't be used in a profile. */
export type CompatReason =
  | { code: "vanilla" }
  /** The mod is only for these loaders. */
  | { code: "loader"; loaders: string[] }
  /** The profile's Minecraft version is outside the mod's range. */
  | { code: "mcVersion"; range: string };

export interface ModCompat {
  /** `unknown`: no readable metadata or range; selectable with a warning. */
  status: "compatible" | "incompatible" | "unknown";
  reason?: CompatReason;
}

/** A mod in the shared library, optionally seen from one profile. */
export interface LibraryMod {
  sha1: string;
  fileName: string;
  /** Missing when the jar has no readable metadata. */
  modId?: string;
  name: string;
  version?: string;
  /** `fabric`, `quilt`, `forge`, `neoforge`; empty = unknown. */
  loaders: string[];
  /** The Minecraft versions the mod declares, as written in its metadata. */
  mcVersionRange?: string;
  hasIcon: boolean;
  addedAt: string;
  /** Ids of the profiles that have it enabled. */
  usedBy: string[];
  /** For a profile's view: enabled in that profile. */
  enabled?: boolean;
  /** For a profile's view: enabled as a copy because hard links don't work there. */
  copied?: boolean;
  /** For a profile's view. */
  compat?: ModCompat;
  /** Where it came from (downloaded, or identified by its hash). */
  source?: { sourceId: string; projectId: string; pageUrl: string };
  /** false = the mod sources haven't been asked about it yet (e.g. offline). */
  checked: boolean;
  /** Only in the library as another mod's dependency (not added by the user). */
  dependency?: boolean;
  /** Library mods (sha1s) that depend on this one. */
  neededBy?: string[];
}

/** One exact match from a mod source, as a confirm card. */
export interface RemoteMatchCard {
  /** Pass to `mods:installRemote`; missing when there's nothing to download. */
  planId?: string;
  sourceId: string;
  project: {
    projectId: string;
    name: string;
    author: string;
    iconUrl?: string;
    pageUrl: string;
    /** How often it was downloaded, when the site says. */
    downloads?: number;
  };
  /** The version that fits the profile; null = none. */
  version: { versionNumber: string; fileName: string } | null;
  /** Required dependencies: downloaded, or reused from the library. */
  dependencies: {
    name: string;
    versionNumber?: string;
    action: "download" | "reuse";
  }[];
  /** Required dependencies with no version for the profile (nothing can be downloaded). */
  missing: string[];
  /** Enabled mods this one is incompatible with. */
  incompatible: string[];
  /** Enabled mods that get replaced by another version. */
  replaces: string[];
  totalSize: number;
}

export interface ModDownloadProgress {
  planId: string;
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

/** Progress of a bulk download (library-wide, or re-applying a profile's mods). */
export interface ModBulkProgress {
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

/** Result of "download all library mods for a version". */
export interface BulkDownloadResult {
  /** Mods whose compatible version was downloaded (or already present). */
  downloaded: number;
  /** Mods with no version for the target. */
  skipped: { name: string }[];
}

/** Result of re-applying a profile's mods after a version change. */
export interface ApplyModsResult {
  /** Mods switched to the version that fits the new target. */
  downloaded: number;
  /** Enabled sourced mods with no compatible version: disabled, kept in the library. */
  disabled: { name: string }[];
  /** Enabled mods with no known source: left as they are (can't be re-fetched). */
  unresolved: { name: string }[];
}

/** What's wrong with an enabled mod (Scope 05). Turned into text by the renderer. */
export type ValidationProblem =
  /** Made only for these loaders. */
  | { code: "wrongLoader"; loaders: string[] }
  /** The profile's Minecraft version is outside the mod's range. */
  | { code: "mcVersion"; range: string; gameVersion: string }
  /** The installed loader build is older than the mod needs. */
  | { code: "loaderVersion"; loader: string; range: string; installed: string }
  /** A required mod isn't enabled (nor provided or bundled by another). `name` for well-known ones. */
  | { code: "missingDep"; depId: string; range: string; name?: string }
  /** A required mod is enabled, but at a version outside the range. */
  | {
      code: "depVersion";
      depId: string;
      range: string;
      found: string;
      otherName: string;
    }
  /** Can't run together with another enabled mod. */
  | { code: "breaks"; otherSha1: string; otherName: string }
  /** May cause problems with another enabled mod. */
  | { code: "conflicts"; otherSha1: string; otherName: string }
  /** Another enabled jar has the same mod id. */
  | { code: "duplicateId"; modId: string; otherSha1: string; otherName: string }
  /** The profile's Java is older than the mod needs. */
  | { code: "java"; range: string; java: number }
  | { code: "damaged"; reason: "missing" | "size" | "unreadable" | "sha1" }
  /** Can't tell: no metadata, a range or version that can't be read, an unmappable Minecraft version. */
  | {
      code: "unknown";
      reason: "noMetadata" | "range" | "version" | "mcVersion";
      detail?: string;
    }
  /** The mod site says something the jar doesn't (or disagrees with it). */
  | {
      code: "sourceMcVersion";
      sourceId: string;
      versions: string;
      gameVersion: string;
    }
  | { code: "sourceLoader"; sourceId: string; loaders: string[] };

export type ValidationFix =
  { kind: "download"; query: string } | { kind: "redownload" };

export type ValidationIssue = ValidationProblem & {
  severity: "error" | "warning";
  modSha1: string;
  fix?: ValidationFix;
};

export interface ValidationReport {
  issues: ValidationIssue[];
  /** Enabled mod → the enabled mods that need it. */
  requiredBy: Record<string, string[]>;
  errorCount: number;
  warningCount: number;
}

/** Mods that "Disable problem mods and play" would disable, with the ones that then miss a dependency. */
export interface DisablePlan {
  mods: { sha1: string; name: string; reason: "error" | "dependency" }[];
}

export interface AddModsResult {
  /** Newly stored in the library. */
  added: number;
  /** Already in the library (same file). */
  existing: number;
  failed: { fileName: string; code: string }[];
}

// ---- Resource packs (Scope 08) ----

/** Can a pack be used with a profile's Minecraft version? */
export type PackCompat = "compatible" | "tooOld" | "tooNew" | "unknown";

export interface PackSourceInfo {
  sourceId: string;
  projectId: string;
  pageUrl: string;
}

/** A resource pack in the library: stored once, shared by the profiles that use it. */
export interface LibraryPack {
  sha1: string;
  fileName: string;
  /** The file name without `.zip`. */
  name: string;
  /** From `pack.mcmeta`, as plain text. */
  description: string;
  hasIcon: boolean;
  size: number;
  addedAt: string;
  /** Profiles it's in (active, or turned off in game). */
  usedBy: string[];
  /** The site's loaders for the downloaded version (shaders: `iris`, `optifine`, …). */
  loaders?: string[];
  source?: PackSourceInfo;
  /** The mod sources were asked about it (or it came from one). */
  checked: boolean;
}

/** A pack as a profile sees it: from the library, or a folder in its `resourcepacks/`. */
export type PackRef =
  { kind: "library"; sha1: string } | { kind: "folder"; name: string };

export interface ProfilePack {
  ref: PackRef;
  name: string;
  description: string;
  hasIcon: boolean;
  compat: PackCompat;
  source?: PackSourceInfo;
}

/** One row of a profile's active packs; built-in packs (e.g. Programmer Art) can't be dragged in. */
export type ActivePack =
  { kind: "pack"; pack: ProfilePack } | { kind: "builtin"; id: string };

/** The active packs to save, highest priority first. */
export type ActivePackRef = PackRef | { kind: "builtin"; id: string };

export interface ProfilePacks {
  /** Highest priority first, as the game's own pack screen shows them. */
  active: ActivePack[];
  /** Library packs and folder packs that aren't active. */
  available: ProfilePack[];
  /** Files in `resourcepacks/` the game can't use. */
  notPacks: {
    name: string;
    reason: "invalid" | "nested" | "unreadable";
    /** For `nested`: the folder `pack.mcmeta` is in. */
    folder?: string;
  }[];
  /** Why the active packs can't be changed right now. */
  locked?: "running" | "versionUnknown" | "unsupported";
}

export type AddPacksResult = AddModsResult;

/** A resource pack found on a site (Modrinth). */
export interface RemotePack {
  sourceId: string;
  projectId: string;
  slug: string;
  name: string;
  author: string;
  description?: string;
  iconUrl?: string;
  downloads?: number;
  pageUrl: string;
  /** Shaders: what runs them (`iris`, `optifine`, `canvas`, `vanilla`); mod packs: their loaders. */
  loaders?: string[];
  /** Mod packs: the Minecraft versions it has versions for. */
  gameVersions?: string[];
}

export interface PackSearchResult {
  hits: RemotePack[];
  /** How many match in all (for "Load more"). */
  total: number;
}

/** Something a downloaded pack needs (a mod, or another pack). */
export interface PackNeed {
  name: string;
  slug: string;
  /** The site's kind: `mod`, `resourcepack`, … */
  projectType: string;
  pageUrl: string;
}

export interface PackInstallResult {
  sha1: string;
  name: string;
  versionNumber: string;
  compat: PackCompat;
  /** No version for the profile's Minecraft version: the newest one was taken. */
  otherVersion: boolean;
  /** Turned on in the profile (false without one, or while it plays). */
  activated: boolean;
  needs: PackNeed[];
}

export interface PackDownloadProgress {
  projectId: string;
  bytes: number;
  totalBytes: number;
}

// ---- Mod packs ----

/** A mod pack file, read and ready to import (`token` names it in later calls). */
export interface ModpackPreview {
  token: string;
  name: string;
  versionNumber: string;
  summary?: string;
  gameVersion: string;
  /** null = vanilla. `fabric`, `quilt`, `forge`, `neoforge`. */
  loader: string | null;
  loaderVersion?: string;
  /** false: its loader isn't supported (Forge, NeoForge); it can't be imported. */
  supported: boolean;
  /** Files it downloads, and how much. */
  files: number;
  downloadBytes: number;
  /** Files inside the pack (configs, resource packs, …). */
  included: number;
  includedBytes: number;
  /** Files the pack marks optional, all chosen at first. */
  optional: { path: string; size: number }[];
  /** From a site: where (for the profile's icon and updates). */
  iconUrl?: string;
}

/** One version of a mod pack on a site. */
export interface ModpackVersion {
  versionId: string;
  versionNumber: string;
  channel: "release" | "beta" | "alpha";
  gameVersions: string[];
  loaders: string[];
  published?: string;
  size: number;
}

export interface ModpackProgress {
  token: string;
  step: "fetch" | "download" | "overrides" | "finish";
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

export type ModpackUpdateAction =
  "add" | "update" | "changed" | "remove" | "keepRemoved";

export interface ModpackUpdatePlan {
  token: string;
  from: string;
  to: string;
  gameVersion: { from: string; to: string };
  loader: { from: string | null; to: string | null };
  items: { path: string; action: ModpackUpdateAction }[];
  supported: boolean;
}

export interface ModpackUpdateResult {
  added: number;
  updated: number;
  removed: number;
  /** The zip of the replaced and removed files, when there were any. */
  backup?: string;
}

export interface ModpackExportOptions {
  /** Top-level files and folders of the profile; `suggested` ones start ticked. */
  entries: { name: string; folder: boolean; suggested: boolean }[];
  name: string;
  versionNumber: string;
}

export interface ModpackExportResult {
  /** Files linked to their site. */
  downloads: number;
  /** Files put inside the pack. */
  included: number;
  /** Mods and packs no site knows, put inside the pack. */
  unknown: string[];
}

// ---- Data packs ----

/** A data pack as a world sees it: from the library, or a folder in its `datapacks/`. */
export interface WorldDataPack {
  ref: PackRef;
  name: string;
  description: string;
  hasIcon: boolean;
  compat: PackCompat;
  /** Turned off in game (the world's `level.dat` lists it as disabled). */
  offInGame: boolean;
  /** Experimental features it needs that the world doesn't have: the game won't load it. */
  missingFeatures: string[];
  source?: PackSourceInfo;
}

export interface WorldDataPacks {
  /** The packs in the world's `datapacks/` folder. */
  inWorld: WorldDataPack[];
  /** Library packs the world doesn't have. */
  available: WorldDataPack[];
  /** Files in `datapacks/` the game can't use. */
  notPacks: ProfilePacks["notPacks"];
  /** Why the world's packs can't be changed right now. */
  locked?: "running" | "unsupported";
}

/** A world for "Add to worlds…": who owns it, and whether it has the pack already. */
export interface DataPackWorld {
  worldId: string;
  name: string;
  profileId: string;
  profileName: string;
  hasPack: boolean;
  /** Its profile's game runs (or starts): it can't be changed now. */
  busy: boolean;
  /** Its Minecraft version has no data packs (before 1.13). */
  unsupported: boolean;
}

export interface AddToWorldsResult {
  added: string[];
  failed: { worldId: string; code: string }[];
}

export interface DataPackInstallResult {
  sha1: string;
  name: string;
  versionNumber: string;
  compat: PackCompat;
  /** No version for the world's Minecraft version: the newest one was taken. */
  otherVersion: boolean;
  /** Put in the world (false without one, or while it plays). */
  added: boolean;
  needs: PackNeed[];
}

// ---- Shader packs ----

/** A shader as a profile sees it: from the library, or a folder in its `shaderpacks/`. */
export interface ProfileShader {
  ref: PackRef;
  name: string;
  hasIcon: boolean;
  /** False when the site lists it only for other loaders (may not work with Iris). */
  irisTagged?: boolean;
  source?: PackSourceInfo;
}

export interface ProfileShaders {
  /** The shader Iris uses; none when shaders are off. */
  active?: PackRef;
  /** Shaders in the profile's `shaderpacks/` (Iris lists them in game). */
  inProfile: ProfileShader[];
  /** Library shaders the profile doesn't have. */
  available: ProfileShader[];
  /** Files in `shaderpacks/` Iris can't use. */
  notPacks: ProfilePacks["notPacks"];
  /** Whether the profile has Iris, which runs shaders (needs Fabric or Quilt). */
  iris: "present" | "missing" | "noLoader";
  /** Why the shaders can't be changed right now. */
  locked?: "running" | "noLoader";
}

export interface ShaderInstallResult {
  sha1: string;
  name: string;
  versionNumber: string;
  /** No version for the profile's Minecraft version: the newest one was taken. */
  otherVersion: boolean;
  /** The site lists the downloaded version for Iris. */
  irisTagged: boolean;
  /** Made the profile's shader (false without one, or while it plays). */
  activated: boolean;
  /** The profile has no Iris yet. */
  irisMissing: boolean;
}

/** What to do with a deleted profile's worlds. */
export type DeleteWorldsChoice = "delete" | { moveTo: string };

export interface VersionListResult {
  versions: VersionSummary[];
  latest?: { release: string; snapshot: string };
  /** `online` = just fetched from Mojang; `cache` = the saved list; `none` = no list yet (offline). */
  source: "online" | "cache" | "none";
  /** When the saved list was fetched from Mojang (ISO date). */
  fetchedAt?: string;
  /** Set when a requested refresh failed; the saved list is still returned. */
  refreshError?: string;
}

export type InstallStep =
  | "metadata"
  | "loader"
  | "checking"
  | "downloading"
  | "java"
  | "natives"
  | "assets";

export interface InstallProgress {
  versionId: string;
  step: InstallStep;
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

export type InstallStatus =
  "queued" | "running" | "done" | "failed" | "cancelled";

export interface InstallStateEvent {
  versionId: string;
  status: InstallStatus;
  error?: { code: string; message: string };
}

export type OnGameStart = "keep" | "minimize" | "close";

/** Automatic world backups: never, on every launch, or every N days. */
export type BackupAuto = "off" | "launch" | "interval";
/** When an automatic backup is made: before the game starts, or after it closes. */
export type BackupWhen = "beforeStart" | "afterExit";

export interface LauncherSettings {
  /** Default `-Xmx` in MB; a profile can replace it. */
  memoryMaxMb: number;
  /** Added after the version's JVM arguments; a profile's own list replaces these. */
  extraJvmArgs: string[];
  /** Added after the version's game arguments; a profile's own list replaces these. */
  extraGameArgs: string[];
  onGameStart: OnGameStart;
  /** Which version types the version list shows; releases always are. */
  showSnapshots: boolean;
  showOldBeta: boolean;
  showOldAlpha: boolean;
  backupAuto: BackupAuto;
  backupWhen: BackupWhen;
  /** For `backupAuto: "interval"`: back up when the last backup is this many days old. */
  backupIntervalDays: number;
  /** Keep at most this many backups per world; null = no limit. */
  backupKeepCount: number | null;
  /** Delete backups older than this many days; null = no limit. A world's newest is always kept. */
  backupKeepDays: number | null;
  /** Last selected profile and account on the home screen. */
  selectedProfileId: string | null;
  selectedAccountId: string | null;
}

/** Moving the data folder (Settings → Data folder → Move my data there). */
export interface MoveProgress {
  step: "counting" | "copying" | "linking" | "cleaning";
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

export interface AccountInfo {
  id: string;
  username: string;
  uuid: string;
}

export interface SetupState {
  dataDir: string | null;
  suggestedDir: string;
}

export interface GameLogEvent {
  launchId: string;
  profileId: string;
  lines: string[];
}

export interface GameExitEvent {
  launchId: string;
  profileId: string;
  versionId: string;
  code: number | null;
  crashed: boolean;
}

export interface RunningGame {
  launchId: string;
  profileId: string;
  accountId: string;
  versionId: string;
  pid: number;
  /** Started straight into this world or onto this server. */
  quickPlay?: QuickPlay;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

/** A Java runtime the launcher downloads from Mojang (Settings → Java). */
export interface JavaRuntimeInfo {
  /** Mojang's component name, e.g. `java-runtime-delta`. */
  component: string;
  /** Full version, e.g. `21.0.7`, when known. */
  versionName?: string;
  /** Major version, e.g. 21. */
  major?: number;
  installed: boolean;
  /** Mojang offers it for this computer (false offline, or no longer listed). */
  available: boolean;
  /** Bytes on disk when installed, or to download otherwise (when known). */
  sizeBytes?: number;
  /** Installed Minecraft versions that run on it. */
  usedBy: string[];
}

/** Java found on the computer outside the launcher (shown, not managed). */
export interface SystemJavaInfo {
  /** The Java home folder. */
  home: string;
  executable: string;
  version?: string;
  major?: number;
  vendor?: string;
}

export interface JavaListResult {
  runtimes: JavaRuntimeInfo[];
  system: SystemJavaInfo[];
  /** Mojang's runtime list couldn't be fetched and there is no saved copy. */
  offline: boolean;
}

export interface JavaInstallProgress {
  component: string;
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

/** Mojang's patch notes for one version (its changelog). */
export interface PatchNotes {
  title: string;
  version: string;
  type: string;
  /** ISO date. */
  date: string;
  /** HTML from Mojang; the renderer rebuilds only safe elements, never injects it. */
  body: string;
}

/** One backup of a world (a zip in `backups/`). */
export interface WorldBackup {
  id: string;
  /** ISO date. */
  createdAt: string;
  /** Size of the zip. */
  sizeBytes: number;
  /** Size of the world when it was backed up. */
  worldBytes: number;
  reason: "manual" | "auto";
}

export interface BackupProgress {
  profileId: string;
  worldId: string;
  worldName: string;
  /** Which world of the job (1-based) and how many there are. */
  index: number;
  total: number;
  bytes: number;
  totalBytes: number;
  /** Runs before the game starts: cancelling skips it and the game still starts. */
  beforeStart: boolean;
}

export interface BackupStateEvent {
  status: "running" | "done" | "failed" | "cancelled";
  profileId: string;
  beforeStart: boolean;
}

/** What a backup job did, by world name. */
export interface BackupResult {
  created: string[];
  /** Not changed since their last backup. */
  unchanged: string[];
  failed: { name: string; code: string }[];
}

export interface BackupSummary {
  count: number;
  totalBytes: number;
  /** Backups of worlds that no longer exist. */
  orphans: { worlds: number; count: number; totalBytes: number };
}
