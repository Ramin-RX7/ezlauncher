import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { FeedFile } from "@shared/updates";
import { AppError } from "../core/errors";
import { renameWithRetry } from "../core/fsAtomic";
import type { FetchFn } from "../minecraft/downloader";

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
  userAgent?: string;
}

/**
 * Download an update file to `dest`, checking its size and SHA-256 from the feed.
 * It's written to a temporary name and renamed only once it checks out, so `dest`
 * is either the right file or not there.
 */
export async function downloadVerified(
  fetch: FetchFn,
  file: FeedFile,
  dest: string,
  { signal, onProgress, userAgent }: DownloadOptions = {},
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.${randomBytes(4).toString("hex")}.part`;
  const cancelled = () => new AppError("CANCELLED", "Download cancelled.");
  try {
    let res: Response;
    try {
      res = await fetch(file.url, {
        ...(signal && { signal }),
        ...(userAgent && { headers: { "User-Agent": userAgent } }),
      });
    } catch (err) {
      if (signal?.aborted) throw cancelled();
      throw new AppError("OFFLINE", "Can't reach the download server.", {
        cause: err,
      });
    }
    if (!res.ok || !res.body)
      throw new AppError(
        "UPDATE_FAILED",
        `Download failed: HTTP ${res.status} for ${file.url}`,
      );

    const hash = createHash("sha256");
    const handle = await open(part, "w");
    const reader =
      res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let received = 0;
    let finished = false;
    onProgress?.(0, file.size);
    try {
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (signal?.aborted) throw cancelled();
          throw new AppError("OFFLINE", "The download was cut off.", {
            cause: err,
          });
        }
        if (chunk.done) break;
        if (signal?.aborted) throw cancelled();
        received += chunk.value.length;
        if (received > file.size)
          throw new AppError("UPDATE_DAMAGED", "The download is too big.");
        hash.update(chunk.value);
        await handle.write(chunk.value);
        onProgress?.(received, file.size);
      }
      finished = true;
      await handle.sync();
    } finally {
      if (!finished) await reader.cancel().catch(() => undefined);
      await handle.close();
    }
    if (received !== file.size || hash.digest("hex") !== file.sha256)
      throw new AppError(
        "UPDATE_DAMAGED",
        `The downloaded ${file.name} doesn't match the release.`,
      );
    await renameWithRetry(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}
