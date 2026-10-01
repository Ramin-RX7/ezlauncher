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
  "ACCOUNT_NAME_TAKEN",
  "ACCOUNT_PLAYING",
  "RENAME_UNSUPPORTED",
  "DATA_DIR_NOT_EMPTY",
  "INVALID_PATH",
  "CANCELLED",
  "MOD_BULK_BUSY",
  "INVALID_TARGET",
  "BACKUP_NOT_FOUND",
  "BACKUP_DAMAGED",
  "BACKUP_FAILED",
  "NOT_A_PACK",
  "PACK_NESTED",
  "PACK_NOT_FOUND",
  "PACK_IN_USE",
  "PACKS_VERSION_UNKNOWN",
  "PACKS_UNSUPPORTED",
  "OPTIONS_UNWRITABLE",
  "PACK_NO_VERSION",
  "NOT_A_SHADER",
  "SHADER_NESTED",
  "SHADER_NOT_FOUND",
  "SHADER_IN_USE",
  "SHADERS_NEED_LOADER",
  "IRIS_CONFIG_UNWRITABLE",
  "SHADER_NO_VERSION",
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
