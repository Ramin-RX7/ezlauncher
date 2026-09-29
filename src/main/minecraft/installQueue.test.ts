import { describe, expect, it } from "vitest";
import type { InstallStateEvent } from "@shared/launcher";
import { InstallQueue } from "./installQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("InstallQueue", () => {
  it("runs one job at a time, in order", async () => {
    const events: string[] = [];
    const queue = new InstallQueue((e) =>
      events.push(`${e.versionId}:${e.status}`),
    );
    const gate = deferred();
    const a = queue.enqueue("a", () => gate.promise);
    const b = queue.enqueue("b", () => Promise.resolve());
    expect(events).toEqual(["a:queued", "a:running", "b:queued"]);
    gate.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual([
      "a:queued",
      "a:running",
      "b:queued",
      "a:done",
      "b:running",
      "b:done",
    ]);
  });

  it("returns the same promise for a version already queued", () => {
    const queue = new InstallQueue();
    const gate = deferred();
    const first = queue.enqueue("a", () => gate.promise);
    expect(queue.enqueue("a", () => Promise.resolve())).toBe(first);
    gate.resolve();
  });

  it("cancels a running job through its signal", async () => {
    const events: InstallStateEvent[] = [];
    const queue = new InstallQueue((e) => events.push(e));
    const job = queue.enqueue(
      "a",
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    expect(queue.cancel("a")).toBe(true);
    await expect(job).rejects.toMatchObject({ code: "CANCELLED" });
    expect(events.at(-1)?.status).toBe("cancelled");
  });

  it("cancels a waiting job without running it, and keeps the running one", async () => {
    const queue = new InstallQueue();
    const gate = deferred();
    let ranB = false;
    const a = queue.enqueue("a", () => gate.promise);
    const b = queue.enqueue("b", () => {
      ranB = true;
      return Promise.resolve();
    });
    queue.cancel("b");
    await expect(b).rejects.toMatchObject({ code: "CANCELLED" });
    expect(queue.isBusy("a")).toBe(true);
    gate.resolve();
    await a;
    expect(ranB).toBe(false);
  });

  it("reports failures with the error code", async () => {
    const events: InstallStateEvent[] = [];
    const queue = new InstallQueue((e) => events.push(e));
    await expect(
      queue.enqueue("a", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(events.at(-1)).toEqual({
      versionId: "a",
      status: "failed",
      error: { code: "INTERNAL", message: "Install failed." },
    });
  });
});
