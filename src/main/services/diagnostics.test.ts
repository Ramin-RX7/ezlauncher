import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LauncherSettings, Profile } from "@shared/launcher";
import type { Account } from "../auth/types";
import { createPaths, type Paths } from "../minecraft/paths";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { createDiagnostics } from "./diagnostics";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-diagnostics-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PROFILE: Profile = {
  id: "p1",
  name: "Survival",
  gameVersion: "1.21.4",
  loader: { id: "fabric", version: "0.16.0" },
  createdAt: "2026-01-01T00:00:00.000Z",
};
const STEVE = {
  id: "a1",
  username: "Steve",
  uuid: "uuid-1",
  providerId: "offline",
} as Account;

function setup(
  overrides: Partial<Parameters<typeof createDiagnostics>[0]> = {},
) {
  return createDiagnostics({
    paths,
    settings: {
      load: () =>
        Promise.resolve({
          ...DEFAULT_SETTINGS,
          selectedProfileId: "p1",
        } as LauncherSettings),
    },
    accounts: { list: () => Promise.resolve([STEVE]) },
    profiles: { list: () => Promise.resolve([PROFILE]) },
    mods: {
      enabledMods: () =>
        Promise.resolve([
          {
            sha1: "aa",
            meta: { name: "Sodium", version: "0.6.0", modId: "sodium" },
          },
        ] as never),
    },
    playTime: { totals: () => Promise.resolve(new Map([["p1", 90_000]])) },
    listJava: () =>
      Promise.resolve({ runtimes: [], system: [], offline: false }),
    validateMods: () =>
      Promise.resolve({
        issues: [],
        requiredBy: {},
        errorCount: 0,
        warningCount: 0,
      }),
    isBusy: () => false,
    ...overrides,
  });
}

describe("createDiagnostics", () => {
  it("collects the selected profile with its mods, crash report and log", async () => {
    const game = paths.gameDir("p1");
    await mkdir(join(game, "crash-reports"), { recursive: true });
    await mkdir(join(game, "logs"), { recursive: true });
    await writeFile(
      join(game, "crash-reports", "crash-1.txt"),
      "---- Minecraft Crash Report ----\nboom",
    );
    await writeFile(join(game, "logs", "latest.log"), "line 1\nline 2\n");

    const info = await setup().collect();
    expect(info.profile).toMatchObject({
      name: "Survival",
      loader: "fabric",
      loaderBuild: "0.16.0",
      playTimeMs: 90_000,
      running: false,
      mods: [
        {
          name: "Sodium",
          version: "0.6.0",
          modId: "sodium",
          fromModrinth: false,
        },
      ],
      crashReport: { name: "crash-1.txt" },
    });
    expect(info.profile?.latestLog).toContain("line 2");
    expect(info.secrets).toEqual({
      dataDir: paths.dataDir,
      playerNames: ["Steve"],
      uuids: ["uuid-1"],
    });
  });

  it("leaves out what can't be read instead of failing", async () => {
    const info = await setup({
      listJava: () => Promise.reject(new Error("offline")),
      validateMods: () => Promise.reject(new Error("broken")),
      accounts: { list: () => Promise.reject(new Error("unreadable")) },
    }).collect("p1");
    expect(info.java).toBeUndefined();
    expect(info.profile?.issues).toEqual([]);
    expect(info.secrets.playerNames).toEqual([]);
  });

  it("has no profile part for a profile that doesn't exist", async () => {
    const info = await setup().collect("gone");
    expect(info.profile).toBeUndefined();
    expect(info.settings).toMatchObject({
      onGameStart: DEFAULT_SETTINGS.onGameStart,
    });
  });
});
