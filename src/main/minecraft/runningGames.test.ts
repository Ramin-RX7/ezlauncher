import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRunningGamesFile,
  processAlive,
  type StoredGame,
} from "./runningGames";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-running-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const game = (pid: number, startedAt: number): StoredGame => ({
  launchId: `l${pid}`,
  profileId: "p",
  accountId: "a",
  versionId: "1.20.1",
  pid,
  startedAt,
});

describe("running games file", () => {
  it("restores only saved games whose process is still alive", async () => {
    const file = join(dir, "running.json");
    const alive = new Set([11]);
    const store = createRunningGamesFile(file, {
      isAlive: (pid) => alive.has(pid),
      now: () => 10_000,
      uptimeMs: () => 9_000,
    });
    await store.save([game(11, 5_000), game(12, 5_000)]);
    expect(await store.restore()).toEqual([game(11, 5_000)]);
  });

  it("forgets games started before the computer last booted", async () => {
    const file = join(dir, "running.json");
    const store = createRunningGamesFile(file, {
      isAlive: () => true, // another process got the old id
      now: () => 10_000,
      uptimeMs: () => 2_000,
    });
    await store.save([game(11, 5_000)]);
    expect(await store.restore()).toEqual([]);
  });

  it("restores nothing from a missing or damaged file", async () => {
    const file = join(dir, "running.json");
    const store = createRunningGamesFile(file);
    expect(await store.restore()).toEqual([]);
    await writeFile(file, "{not json");
    expect(await store.restore()).toEqual([]);
  });

  it("knows this process is alive and a bad id is not", () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(-1)).toBe(false);
    expect(processAlive(0)).toBe(false);
  });
});
