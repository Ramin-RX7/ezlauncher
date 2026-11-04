import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LauncherSettings,
  Profile,
  RunningGame,
  ValidationReport,
} from "@shared/launcher";
import type { Account } from "../auth/types";
import { AppError } from "../core/errors";
import { createLogger } from "../core/logger";
import type { GameExit, GameHandle } from "../minecraft/gameProcess";
import type { InstalledVersion } from "../minecraft/installer";
import { createPaths, type Paths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { offlineUuid } from "../auth/providers/offline";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { createGameService } from "./games";
import { createRuntime } from "./runtime";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-games-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  // The service saves running.json in the background; Windows may still hold it.
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const PROFILE: Profile = {
  id: "p1",
  name: "Survival",
  gameVersion: "1.21.4",
  loader: { id: "fabric" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const account = (id: string, username: string): Account => ({
  id,
  username,
  uuid: offlineUuid(username),
  providerId: "offline",
});
const ACCOUNTS = [account("a1", "Steve"), account("a2", "Alex")];

const installed: InstalledVersion = {
  version: {
    id: "1.21.4",
    chain: ["1.21.4"],
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    arguments: {
      jvm: ["-cp", "${classpath}"],
      game: ["--username", "${auth_player_name}"],
    },
  },
  libraries: { classpath: [], natives: [] },
  clientJar: "/data/versions/v/v.jar",
  assetIndex: { objects: {} },
  assetIndexId: "idx",
  javaPath: "/java",
};

const report = (errorCount: number): ValidationReport => ({
  issues: [],
  requiredBy: {},
  errorCount,
  warningCount: 1,
});

function setup({ errors = 0 } = {}) {
  const runtime = createRuntime();
  const exits: ((exit: GameExit) => void)[] = [];
  const launchGame = vi.fn((): Promise<GameHandle> =>
    Promise.resolve({
      pid: 4242,
      onLog: () => undefined,
      onExit: (listener) => {
        exits.push(listener);
      },
      detach: () => undefined,
    }),
  );
  const events = {
    started: [] as RunningGame[],
    exited: [] as unknown[],
    synced: [] as (string[] | undefined)[],
    backups: [] as string[],
    onStart: [] as string[],
    recorded: [] as string[],
  };
  const touchLastPlayed = vi.fn(() => Promise.resolve(PROFILE));
  const service = createGameService({
    paths,
    platform: detectPlatform("linux", "x64", "6.1"),
    runtime,
    settings: {
      load: () =>
        Promise.resolve({
          ...DEFAULT_SETTINGS,
          onGameStart: "minimize",
        } as LauncherSettings),
    },
    accounts: {
      get: (id) => Promise.resolve(ACCOUNTS.find((a) => a.id === id)),
      list: () => Promise.resolve(ACCOUNTS),
    },
    profiles: {
      setInstalled: () => Promise.resolve(PROFILE),
      touchLastPlayed,
    },
    mods: { disable: () => Promise.resolve() },
    playTime: {
      record: (profileId: string) => {
        events.recorded.push(profileId);
        return Promise.resolve();
      },
      history: () => Promise.resolve({ totalMs: 0, sessions: [] }),
    },
    requireProfile: (id) =>
      id === PROFILE.id
        ? Promise.resolve(PROFILE)
        : Promise.reject(new AppError("PROFILE_NOT_FOUND", "gone")),
    sync: (only) => {
      events.synced.push(only);
      return Promise.resolve();
    },
    changed: () => undefined,
    ensureProfileInstall: () =>
      Promise.resolve({ versionId: "1.21.4", installed }),
    checkProfileMods: () =>
      Promise.resolve({
        input: { gameVersion: "", loader: null, mods: [] },
        report: report(errors),
      }),
    autoBackup: (profileId, moment) => {
      events.backups.push(`${profileId}:${moment}`);
      return Promise.resolve(undefined);
    },
    manifestVersions: () => Promise.resolve(undefined),
    launchGame,
    launcherVersion: "0.0.0-test",
    applyOnGameStart: (mode) => {
      events.onStart.push(mode);
    },
    started: (game) => {
      events.started.push(game);
    },
    gameLog: () => undefined,
    exited: (e) => {
      events.exited.push(e);
    },
    logger: createLogger({ console: false }),
  });
  return { service, runtime, events, exits, launchGame, touchLastPlayed };
}

describe("createGameService", () => {
  it("starts a game, and on its exit records play time, syncs and backs up", async () => {
    const { service, runtime, events, exits, touchLastPlayed } = setup();
    const result = await service.api.launch({
      profileId: "p1",
      accountId: "a1",
    });
    expect(result).toMatchObject({ status: "started", warnings: 1 });
    expect(service.api.runningGames()).toEqual([
      expect.objectContaining({ profileId: "p1", accountId: "a1", pid: 4242 }),
    ]);
    expect(runtime.starting.size).toBe(0);
    expect(events.started).toHaveLength(1);
    expect(events.backups).toEqual(["p1:beforeStart"]);
    expect(events.onStart).toEqual(["minimize"]);
    expect(touchLastPlayed).toHaveBeenCalledWith("p1");

    exits[0]?.({ code: 0, signal: null, crashed: false });
    await vi.waitFor(() => {
      expect(events.backups).toEqual(["p1:beforeStart", "p1:afterExit"]);
    });
    expect(service.api.runningGames()).toEqual([]);
    expect(events.exited).toEqual([
      expect.objectContaining({ profileId: "p1", code: 0, crashed: false }),
    ]);
    expect(events.recorded).toEqual(["p1"]);
    expect(events.synced).toContainEqual(["p1"]);
  });

  it("lets each account play a profile once at a time", async () => {
    const { service } = setup();
    await service.api.launch({ profileId: "p1", accountId: "a1" });
    await expect(
      service.api.launch({ profileId: "p1", accountId: "a1" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_PLAYING" });
    await expect(
      service.api.launch({ profileId: "p1", accountId: "a2" }),
    ).resolves.toMatchObject({ status: "started" });
    await expect(
      service.api.launch({ profileId: "p1", accountId: "nobody" }),
    ).rejects.toMatchObject({ code: "NO_ACCOUNT" });
  });

  it("stops at mod errors unless told to play anyway", async () => {
    const { service, runtime, launchGame } = setup({ errors: 2 });
    const blocked = await service.api.launch({
      profileId: "p1",
      accountId: "a1",
    });
    expect(blocked).toMatchObject({ status: "blocked" });
    expect(launchGame).not.toHaveBeenCalled();
    expect(runtime.starting.size).toBe(0);
    await expect(
      service.api.launch({
        profileId: "p1",
        accountId: "a1",
        problems: "ignore",
      }),
    ).resolves.toMatchObject({ status: "started" });
  });

  it("checks Quick Play targets and refuses during a data move", async () => {
    const { service, runtime } = setup();
    await expect(
      service.api.launch({
        profileId: "p1",
        accountId: "a1",
        quickPlay: { kind: "server", address: "not an address::" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(
      service.api.launch({
        profileId: "p1",
        accountId: "a1",
        quickPlay: { kind: "world", worldId: "Missing" },
      }),
    ).rejects.toMatchObject({ code: "WORLD_NOT_FOUND" });
    runtime.moving = true;
    await expect(
      service.api.launch({ profileId: "p1", accountId: "a1" }),
    ).rejects.toMatchObject({ code: "BUSY" });
  });
});
