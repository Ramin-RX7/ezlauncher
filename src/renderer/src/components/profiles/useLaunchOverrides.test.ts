import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Profile } from "@shared/launcher";
import { useLaunchOverrides } from "./useLaunchOverrides";

const profile = (patch: Partial<Profile> = {}): Profile => ({
  id: "p1",
  name: "Survival",
  gameVersion: "1.21.4",
  loader: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("useLaunchOverrides", () => {
  it("uses the global settings unless the profile has its own", () => {
    const { result } = renderHook(() => useLaunchOverrides(undefined));
    expect(result.current.valid).toBe(true);
    expect(result.current.values()).toEqual({
      memoryMaxMb: null,
      extraJvmArgs: null,
      extraGameArgs: null,
    });

    const own = renderHook(() =>
      useLaunchOverrides(
        profile({ memoryMaxMb: 4096, extraJvmArgs: ["-XX:+UseG1GC"] }),
      ),
    );
    expect(own.result.current.values()).toEqual({
      memoryMaxMb: 4096,
      extraJvmArgs: ["-XX:+UseG1GC"],
      extraGameArgs: null,
    });
  });

  it("checks the memory range and the arguments' quoting", () => {
    const { result } = renderHook(() => useLaunchOverrides(undefined));
    act(() => {
      result.current.set({ globalMemory: false, memory: "256" });
    });
    expect(result.current.memoryValid).toBe(false);
    act(() => {
      result.current.set({ memory: "3072" });
    });
    expect(result.current.valid).toBe(true);
    act(() => {
      result.current.set({ globalGame: false, gameArgs: '--title "unclosed' });
    });
    expect(result.current.valid).toBe(false);
    // Back on the global setting, the profile's own text doesn't count.
    act(() => {
      result.current.set({ globalGame: true });
    });
    expect(result.current.valid).toBe(true);
    expect(result.current.values().memoryMaxMb).toBe(3072);
  });
});
