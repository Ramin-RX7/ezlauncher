import type { LauncherSettings, Profile } from "@shared/launcher";

export interface LaunchSettings {
  memoryMaxMb: number;
  extraJvmArgs: string[];
  extraGameArgs: string[];
}

/**
 * The memory and extra arguments a launch uses. A profile's own value *replaces*
 * the global one (it's never added to it); a missing value means "use global".
 */
export function resolveLaunchSettings(
  profile: Pick<Profile, "memoryMaxMb" | "extraJvmArgs" | "extraGameArgs">,
  settings: Pick<
    LauncherSettings,
    "memoryMaxMb" | "extraJvmArgs" | "extraGameArgs"
  >,
): LaunchSettings {
  return {
    memoryMaxMb: profile.memoryMaxMb ?? settings.memoryMaxMb,
    extraJvmArgs: [...(profile.extraJvmArgs ?? settings.extraJvmArgs)],
    extraGameArgs: [...(profile.extraGameArgs ?? settings.extraGameArgs)],
  };
}
