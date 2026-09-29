import type { TFunction } from "i18next";
import { IpcCallError } from "./api";

const KNOWN = [
  "OFFLINE",
  "DOWNLOAD_FAILED",
  "HASH_MISMATCH",
  "JAVA_UNAVAILABLE",
  "NO_ACCOUNT",
  "INVALID_USERNAME",
  "LAUNCH_FAILED",
  "VERSION_UNKNOWN",
  "GAME_RUNNING",
  "BUSY",
  "MISSING_FILE",
  "NOT_FOUND",
  "BAD_RESPONSE",
  "LOADER_UNSUPPORTED",
  "PROFILE_NOT_FOUND",
  "INVALID_PROFILE",
  "VERSION_IN_USE",
  "WORLD_NOT_LINKED",
  "WORLD_NOT_FOUND",
  "LOADER_UNKNOWN",
  "MOD_INCOMPATIBLE",
  "MOD_IN_USE",
  "MOD_NOT_FOUND",
  "NOT_A_JAR",
  "FILE_CHANGED",
  "MODRINTH_ERROR",
  "MOD_DEPENDENCY_MISSING",
  "PLAN_EXPIRED",
  "SOURCE_UNKNOWN",
  "MOD_REQUIRED",
  "MOD_NO_SOURCE",
] as const;

/** A user-facing message for an error code from the main process. */
export function errorMessage(t: TFunction, error: unknown): string {
  const code =
    error instanceof IpcCallError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
  const known = KNOWN.find((k) => k === code);
  return known ? t(`errors.${known}`) : t("errors.generic");
}
