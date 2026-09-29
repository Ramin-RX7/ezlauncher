import { describe, expect, it } from "vitest";
import { resolveLaunchSettings } from "./launchSettings";

const global = {
  memoryMaxMb: 4096,
  extraJvmArgs: ["-XX:+UseG1GC"],
  extraGameArgs: ["--width", "1280"],
};

describe("resolveLaunchSettings", () => {
  it("uses the global values for a profile that sets none", () => {
    expect(resolveLaunchSettings({}, global)).toEqual(global);
  });

  it("replaces each global value with the profile's own, never adding to it", () => {
    expect(
      resolveLaunchSettings(
        {
          memoryMaxMb: 6144,
          extraJvmArgs: ["-XX:+UseZGC"],
          extraGameArgs: ["--fullscreen"],
        },
        global,
      ),
    ).toEqual({
      memoryMaxMb: 6144,
      extraJvmArgs: ["-XX:+UseZGC"],
      extraGameArgs: ["--fullscreen"],
    });
  });

  it("overrides one value and keeps the global others", () => {
    expect(resolveLaunchSettings({ extraGameArgs: [] }, global)).toEqual({
      ...global,
      extraGameArgs: [], // an empty override means none, not the global ones
    });
  });
});
