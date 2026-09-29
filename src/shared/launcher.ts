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
  | { status: "started"; game: RunningGame; warnings: number }
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
