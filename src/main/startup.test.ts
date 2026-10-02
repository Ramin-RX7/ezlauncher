import { describe, expect, it } from "vitest";
import { profileFromArgv, profileRoute } from "./startup";

const ID = "4f3c2b1a-0000-4000-8000-123456789abc";

describe("profileFromArgv", () => {
  it("finds the flag wherever it is", () => {
    expect(profileFromArgv(["EZLauncher.exe", `--ezl-profile=${ID}`])).toBe(ID);
    // A dev run, and Chromium's own switches before it.
    expect(
      profileFromArgv([
        "electron.exe",
        "C:/app",
        "--allow-file-access-from-files",
        `--ezl-profile=${ID}`,
      ]),
    ).toBe(ID);
  });

  it("ignores missing and unsafe ids", () => {
    expect(profileFromArgv(["EZLauncher.exe"])).toBeUndefined();
    expect(profileFromArgv(["x", "--ezl-profile=../../etc"])).toBeUndefined();
    expect(profileFromArgv(["x", "--ezl-profile="])).toBeUndefined();
  });

  it("opens the profile's page", () => {
    expect(profileRoute(ID)).toBe(`/profiles/${ID}`);
  });
});
