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

/** An installed version as shown on the Versions page. */
export interface InstalledVersionInfo extends VersionSummary {
  /** Ids of the profiles that play this version (directly or through a loader install). */
  usedBy: string[];
  /** Installed versions built on this one (e.g. loader installs). */
  dependents: string[];
}

/** Every launch is a profile played by an account. */
export interface LaunchRequest {
  profileId: string;
  accountId: string;
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
  /** null = Vanilla. The loader build is the latest one at install time. */
  loader: { id: string } | null;
  /** A built-in profile icon id (renderer asset). Missing = the default icon. */
  iconId?: string;
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

/** What the user edits. `null` clears an optional value. */
export interface ProfileInput {
  name: string;
  gameVersion: string;
  loader: { id: string } | null;
  /** A built-in icon id, or `null` to clear it. */
  iconId?: string | null;
  memoryMaxMb?: number | null;
  extraJvmArgs?: string[] | null;
  extraGameArgs?: string[] | null;
}

export interface ProfileInfo extends Profile {
  /** How many games of this profile are running. */
  running: number;
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
