import type { InstallStateEvent } from "@shared/launcher";
import { AppError } from "../core/errors";

type Job<T> = (signal: AbortSignal) => Promise<T>;

interface Entry {
  versionId: string;
  controller: AbortController;
  run: () => Promise<void>;
  cancelWaiting: () => void;
  promise: Promise<unknown>;
}

/**
 * Runs one install at a time; later requests wait in order.
 * Asking for a version that's already queued or running returns the same promise.
 */
export class InstallQueue {
  private readonly waiting: Entry[] = [];
  private running: Entry | undefined;

  constructor(
    private readonly onState: (event: InstallStateEvent) => void = () =>
      undefined,
  ) {}

  enqueue<T>(versionId: string, job: Job<T>): Promise<T> {
    const existing = this.find(versionId);
    if (existing) return existing.promise as Promise<T>;

    const controller = new AbortController();
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Callers may only care about state events; never leave a rejection unhandled.
    promise.catch(() => undefined);

    const cancelled = (cause?: unknown): void => {
      this.onState({ versionId, status: "cancelled" });
      reject(new AppError("CANCELLED", "Install cancelled.", { cause }));
    };

    const entry: Entry = {
      versionId,
      controller,
      promise,
      cancelWaiting: () => {
        cancelled();
      },
      run: async () => {
        this.onState({ versionId, status: "running" });
        try {
          const value = await job(controller.signal);
          this.onState({ versionId, status: "done" });
          resolve(value);
        } catch (err) {
          if (
            controller.signal.aborted ||
            (err instanceof AppError && err.code === "CANCELLED")
          ) {
            cancelled(err);
          } else {
            const error =
              err instanceof AppError
                ? { code: err.code, message: err.message }
                : { code: "INTERNAL", message: "Install failed." };
            this.onState({ versionId, status: "failed", error });
            reject(err);
          }
        }
      },
    };

    this.waiting.push(entry);
    this.onState({ versionId, status: "queued" });
    this.next();
    return promise;
  }

  /** Cancel a queued or running install. Returns false if there was none. */
  cancel(versionId: string): boolean {
    if (this.running?.versionId === versionId) {
      this.running.controller.abort();
      return true;
    }
    const index = this.waiting.findIndex((e) => e.versionId === versionId);
    if (index === -1) return false;
    const [entry] = this.waiting.splice(index, 1);
    entry?.cancelWaiting();
    return true;
  }

  isBusy(versionId: string): boolean {
    return this.find(versionId) !== undefined;
  }

  /** Is any install running or waiting? */
  isAnyBusy(): boolean {
    return this.running !== undefined || this.waiting.length > 0;
  }

  private find(versionId: string): Entry | undefined {
    if (this.running?.versionId === versionId) return this.running;
    return this.waiting.find((e) => e.versionId === versionId);
  }

  private next(): void {
    if (this.running) return;
    const entry = this.waiting.shift();
    if (!entry) return;
    this.running = entry;
    void entry.run().finally(() => {
      if (this.running === entry) this.running = undefined;
      this.next();
    });
  }
}
