import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime";

const game = (launchId: string, profileId: string) => ({
  launchId,
  profileId,
  accountId: "a1",
  versionId: "1.21.4",
  pid: 1,
});

describe("createRuntime", () => {
  it("counts a profile as busy while a game runs, starts or its pack updates", () => {
    const rt = createRuntime();
    expect(rt.isBusy("p1")).toBe(false);

    rt.running.set("l1", game("l1", "p1"));
    expect(rt.isRunning("p1")).toBe(true);
    expect(rt.isBusy("p1")).toBe(true);
    expect(rt.isBusy("p2")).toBe(false);
    rt.running.delete("l1");

    rt.starting.add("p1:a1");
    expect(rt.isRunning("p1")).toBe(false);
    expect(rt.isBusy("p1")).toBe(true);
    // Only a whole profile id matches, not one that starts the same way.
    expect(rt.isBusy("p")).toBe(false);
    rt.starting.clear();

    rt.packUpdating.add("p1");
    expect(rt.isBusy("p1")).toBe(true);
  });

  it("refuses with BUSY during a pack update, else GAME_RUNNING", () => {
    const rt = createRuntime();
    expect(() => {
      rt.assertNotRunning("p1");
    }).not.toThrow();

    rt.starting.add("p1:a1");
    expect(() => {
      rt.assertNotRunning("p1");
    }).toThrow(expect.objectContaining({ code: "GAME_RUNNING" }));

    rt.packUpdating.add("p1");
    expect(() => {
      rt.assertNotRunning("p1");
    }).toThrow(expect.objectContaining({ code: "BUSY" }));
  });

  it("runs folder work one at a time, in order, past failures", async () => {
    const rt = createRuntime();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = rt.serialFs(async () => {
      await gate;
      order.push("first");
    });
    const failing = rt.serialFs(() => {
      order.push("failing");
      return Promise.reject(new Error("boom"));
    });
    const last = rt.serialFs(() => {
      order.push("last");
      return Promise.resolve(42);
    });
    expect(order).toEqual([]);
    release();
    await first;
    await expect(failing).rejects.toThrow("boom");
    await expect(last).resolves.toBe(42);
    expect(order).toEqual(["first", "failing", "last"]);
  });
});
