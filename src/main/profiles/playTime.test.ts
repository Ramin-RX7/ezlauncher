import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlayTime, MAX_SESSIONS } from "./playTime";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-playtime-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = () => createPlayTime(join(dir, "playtime.json"));
const HOUR = 3_600_000;

describe("play time", () => {
  it("adds up sessions per profile, newest first", async () => {
    const s = store();
    await s.record("p1", { startedAt: 0, endedAt: HOUR, accountId: "a" });
    await s.record("p1", {
      startedAt: 2 * HOUR,
      endedAt: 2.5 * HOUR,
      accountId: "b",
      quickPlay: { kind: "world", worldId: "W" },
    });
    await s.record("p2", { startedAt: 0, endedAt: 60_000, accountId: "a" });
    expect(await store().totals()).toEqual(
      new Map([
        ["p1", 1.5 * HOUR],
        ["p2", 60_000],
      ]),
    );
    const history = await store().history("p1");
    expect(history.totalMs).toBe(1.5 * HOUR);
    expect(history.sessions.map((x) => x.accountId)).toEqual(["b", "a"]);
  });

  it("ignores nonsense sessions", async () => {
    const s = store();
    await s.record("p", { startedAt: 10, endedAt: 5, accountId: "a" });
    await s.record("p", { startedAt: 0, endedAt: 72 * HOUR, accountId: "a" });
    expect(await s.totals()).toEqual(new Map());
  });

  it(
    "keeps the newest sessions but counts them all",
    { timeout: 30_000 },
    async () => {
      const s = store();
      for (let i = 0; i < MAX_SESSIONS + 5; i++)
        await s.record("p", {
          startedAt: i * HOUR,
          endedAt: i * HOUR + 1000,
          accountId: "a",
        });
      const history = await s.history("p");
      expect(history.totalMs).toBe((MAX_SESSIONS + 5) * 1000);
      expect(history.sessions).toHaveLength(MAX_SESSIONS);
      expect(history.sessions[0]?.startedAt).toBe((MAX_SESSIONS + 4) * HOUR);
    },
  );

  it("forgets a deleted profile", async () => {
    const s = store();
    await s.record("p", { startedAt: 0, endedAt: 1000, accountId: "a" });
    await s.forget("p");
    expect(await s.history("p")).toEqual({ totalMs: 0, sessions: [] });
  });
});
