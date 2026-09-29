import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { AppError } from "../core/errors";
import { renameWithRetry } from "../core/fsAtomic";
import type { Logger } from "../core/logger";
import type { FileTask } from "./fileTask";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface DownloadProgress {
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
}

export interface DownloaderOptions {
  fetch: FetchFn;
  userAgent: string;
  concurrency?: number;
  retries?: number;
  /** Base delay for retries; doubles each attempt. */
  retryDelayMs?: number;
  logger?: Logger;
  /** Called once per HTTP request; used by tests and the dev CLI to count requests. */
  onRequest?: (url: string) => void;
}

export interface Downloader {
  /** Download all tasks. Tasks must already be filtered to the ones that are missing or bad. */
  run(tasks: readonly FileTask[], options?: RunOptions): Promise<void>;
  /** Fetch a small resource (JSON) into memory. A 404 fails with code `NOT_FOUND`. */
  fetchText(url: string, options?: { signal?: AbortSignal }): Promise<string>;
}

/** No response at all (DNS, refused, reset): the machine is probably offline. */
class NetworkError extends Error {}
/** Got a response, but it's permanently wrong (e.g. 404): retrying won't help. */
class PermanentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AppError("CANCELLED", "Download cancelled.");
}

export function createDownloader(options: DownloaderOptions): Downloader {
  const {
    fetch,
    userAgent,
    concurrency = 8,
    retries = 5,
    retryDelayMs = 500,
    logger,
    onRequest,
  } = options;
  const headers = { "User-Agent": userAgent };

  async function request(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    onRequest?.(url);
    let res: Response;
    try {
      res = await fetch(url, { headers, ...(signal && { signal }) });
    } catch (err) {
      throwIfAborted(signal);
      throw new NetworkError(`Network error for ${url}`, { cause: err });
    }
    if (!res.ok) {
      const message = `HTTP ${res.status} for ${url}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new PermanentError(message, res.status);
      }
      throw new Error(message);
    }
    return res;
  }

  async function withRetries<T>(
    what: string,
    signal: AbortSignal | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      try {
        return await fn();
      } catch (err) {
        if (err instanceof AppError && err.code === "CANCELLED") throw err;
        throwIfAborted(signal);
        const last = attempt >= retries || err instanceof PermanentError;
        if (last) {
          if (err instanceof NetworkError) {
            throw new AppError("OFFLINE", "Can't reach the download server.", {
              cause: err,
            });
          }
          if (err instanceof AppError) throw err;
          throw new AppError("DOWNLOAD_FAILED", `Download failed: ${what}`, {
            cause: err,
          });
        }
        logger?.warn(`retrying ${what} (attempt ${attempt + 2})`, err);
        await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
      }
    }
  }

  async function downloadOnce(
    task: FileTask & { url: string },
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    await mkdir(dirname(task.dest), { recursive: true });
    const part = `${task.dest}.${randomBytes(4).toString("hex")}.part`;
    let written = 0;
    try {
      const res = await request(task.url, signal);
      if (!res.body) throw new Error(`Empty response for ${task.url}`);
      const hash = createHash("sha1");
      const handle = await open(part, "w");
      const reader =
        res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      let finished = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          throwIfAborted(signal);
          hash.update(value);
          await handle.write(value);
          written += value.length;
          onBytes(value.length);
        }
        finished = true;
      } finally {
        // Stopped early: close the connection instead of leaving the body unread.
        if (!finished) await reader.cancel().catch(() => undefined);
        await handle.close();
      }
      if (task.size !== undefined && written !== task.size) {
        throw new AppError(
          "HASH_MISMATCH",
          `Wrong size for ${task.url}: ${written} instead of ${task.size}`,
        );
      }
      const sha1 = hash.digest("hex");
      if (task.sha1 && sha1 !== task.sha1.toLowerCase()) {
        throw new AppError("HASH_MISMATCH", `Wrong checksum for ${task.url}`);
      }
      await renameWithRetry(part, task.dest);
    } catch (err) {
      onBytes(-written); // the retry downloads these bytes again
      await rm(part, { force: true });
      throw err;
    }
  }

  return {
    async fetchText(url, opts = {}) {
      try {
        return await withRetries(url, opts.signal, async () =>
          (await request(url, opts.signal)).text(),
        );
      } catch (err) {
        if (
          err instanceof AppError &&
          err.cause instanceof PermanentError &&
          err.cause.status === 404
        ) {
          throw new AppError("NOT_FOUND", `Not found: ${url}`, { cause: err });
        }
        throw err;
      }
    },

    async run(tasks, { signal, onProgress } = {}) {
      for (const t of tasks) {
        if (!t.url) {
          throw new AppError(
            "MISSING_FILE",
            `${t.dest} is missing and can't be downloaded.`,
          );
        }
      }
      const queue = tasks as readonly (FileTask & { url: string })[];
      const progress: DownloadProgress = {
        files: 0,
        totalFiles: queue.length,
        bytes: 0,
        totalBytes: queue.reduce((sum, t) => sum + (t.size ?? 0), 0),
      };

      let lastEmit = 0;
      const emit = (force = false): void => {
        const now = Date.now();
        if (!onProgress || (!force && now - lastEmit < 100)) return;
        lastEmit = now;
        onProgress({ ...progress });
      };
      emit(true);

      // Stop all workers on the first failure or on cancel.
      const inner = new AbortController();
      const onAbort = (): void => {
        inner.abort();
      };
      signal?.addEventListener("abort", onAbort);

      let next = 0;
      let failure: unknown;
      const worker = async (): Promise<void> => {
        while (next < queue.length && !inner.signal.aborted) {
          const task = queue[next++] as FileTask & { url: string };
          try {
            await withRetries(task.url, inner.signal, () =>
              downloadOnce(task, inner.signal, (n) => {
                progress.bytes += n;
                emit();
              }),
            );
            progress.files++;
            emit();
          } catch (err) {
            failure ??= err;
            inner.abort();
          }
        }
      };

      try {
        await Promise.all(
          Array.from({ length: Math.min(concurrency, queue.length) }, () =>
            worker(),
          ),
        );
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      if (signal?.aborted)
        throw new AppError("CANCELLED", "Download cancelled.");
      if (failure) {
        throw failure instanceof Error
          ? failure
          : new AppError("DOWNLOAD_FAILED", "Download failed.", {
              cause: failure,
            });
      }
      emit(true);
    },
  };
}
