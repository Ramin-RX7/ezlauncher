/** Data shapes shared by the main process and the renderer. No Node or DOM types here. */

export type VersionType =
  "release" | "snapshot" | "old_beta" | "old_alpha" | (string & {});

export interface VersionSummary {
  id: string;
  type: VersionType;
  releaseTime: string;
  installed: boolean;
}

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
  "metadata" | "checking" | "downloading" | "java" | "natives" | "assets";

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
  memoryMaxMb: number;
  onGameStart: OnGameStart;
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
  versionId: string;
  lines: string[];
}

export interface GameExitEvent {
  launchId: string;
  versionId: string;
  code: number | null;
  crashed: boolean;
}

export interface RunningGame {
  launchId: string;
  versionId: string;
  pid: number;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
