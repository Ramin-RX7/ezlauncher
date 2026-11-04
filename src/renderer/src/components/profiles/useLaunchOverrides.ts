import { useState } from "react";
import { joinArgs, splitArgs } from "@shared/args";
import type { Profile, ProfileInput } from "@shared/launcher";

export const MEMORY_MIN = 512;
export const MEMORY_MAX = 65536;

/** Each override: "use global" (the default), or the profile's own value that replaces it. */
interface OverridesState {
  globalMemory: boolean;
  memory: string;
  globalJvm: boolean;
  jvmArgs: string;
  globalGame: boolean;
  gameArgs: string;
}

/** A profile's memory and argument overrides: the form state, its check, and the saved values. */
export function useLaunchOverrides(profile: Profile | undefined) {
  const [state, setState] = useState<OverridesState>(() => ({
    globalMemory: profile?.memoryMaxMb === undefined,
    memory:
      profile?.memoryMaxMb !== undefined ? String(profile.memoryMaxMb) : "",
    globalJvm: profile?.extraJvmArgs === undefined,
    jvmArgs: joinArgs(profile?.extraJvmArgs ?? []),
    globalGame: profile?.extraGameArgs === undefined,
    gameArgs: joinArgs(profile?.extraGameArgs ?? []),
  }));
  const set = (patch: Partial<OverridesState>) => {
    setState((s) => ({ ...s, ...patch }));
  };

  const memoryNumber = Number(state.memory);
  const memoryValid =
    state.globalMemory ||
    (state.memory.trim() !== "" &&
      Number.isInteger(memoryNumber) &&
      memoryNumber >= MEMORY_MIN &&
      memoryNumber <= MEMORY_MAX);
  const jvmSplit = splitArgs(state.jvmArgs);
  const gameSplit = splitArgs(state.gameArgs);
  const argsValid =
    (state.globalJvm || !("error" in jvmSplit)) &&
    (state.globalGame || !("error" in gameSplit));

  return {
    state,
    set,
    memoryValid,
    valid: memoryValid && argsValid,
    /** The overrides as saved: `null` = use the global setting. */
    values: (): Pick<
      ProfileInput,
      "memoryMaxMb" | "extraJvmArgs" | "extraGameArgs"
    > => ({
      memoryMaxMb: state.globalMemory ? null : memoryNumber,
      extraJvmArgs:
        state.globalJvm || "error" in jvmSplit ? null : jvmSplit.args,
      extraGameArgs:
        state.globalGame || "error" in gameSplit ? null : gameSplit.args,
    }),
  };
}

export type LaunchOverrides = ReturnType<typeof useLaunchOverrides>;
