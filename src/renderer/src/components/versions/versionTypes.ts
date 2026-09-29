import type { LauncherSettings } from "@shared/launcher";
import type { VersionTab } from "./VersionList";

/** The version types the Settings toggles turn on; releases always. */
export function visibleTypes(
  settings:
    | Pick<LauncherSettings, "showSnapshots" | "showOldBeta" | "showOldAlpha">
    | undefined,
): VersionTab[] {
  return [
    "release",
    ...(settings?.showSnapshots ? (["snapshot"] as const) : []),
    ...(settings?.showOldBeta ? (["old_beta"] as const) : []),
    ...(settings?.showOldAlpha ? (["old_alpha"] as const) : []),
  ];
}
