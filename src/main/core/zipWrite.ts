import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { AppError } from "./errors";

/*
 * Write a zip from files on disk and small in-memory entries, streaming (files are
 * never read whole). It's written as `<dest>.part` and renamed when complete.
 */

export type ZipSource =
  | { name: string; path: string; mtimeMs?: number }
  | { name: string; data: Uint8Array };

/** Zip dates must be 1980–2099. */
const zipDate = (ms: number) =>
  Math.min(Math.max(ms, Date.UTC(1980, 0, 2)), Date.UTC(2099, 11, 30));

/** Already-compressed files gain nothing from deflating again. */
const STORED = /\.(zip|jar|mrpack|png|jpe?g|gif|webp|ogg|mp3)$/i;

export async function writeZip(
  dest: string,
  entries: Iterable<ZipSource>,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (bytes: number) => void } = {},
): Promise<void> {
  const part = `${dest}.part`;
  await mkdir(dirname(dest), { recursive: true });
  const out = createWriteStream(part);
  let zipError: Error | undefined;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });
  const check = () => {
    if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled.");
    if (zipError) throw zipError;
  };
  let bytes = 0;
  try {
    for (const e of entries) {
      check();
      const entry = STORED.test(e.name)
        ? new ZipPassThrough(e.name)
        : new ZipDeflate(e.name, { level: 6 });
      if ("path" in e && e.mtimeMs !== undefined)
        entry.mtime = zipDate(e.mtimeMs);
      zip.add(entry);
      if ("data" in e) {
        entry.push(e.data, true);
        bytes += e.data.length;
        continue;
      }
      for await (const chunk of createReadStream(e.path, {
        highWaterMark: 256 * 1024,
      })) {
        const data = chunk as Buffer;
        entry.push(data, false);
        bytes += data.length;
        onProgress?.(bytes);
        check();
        if (out.writableNeedDrain) await once(out, "drain");
      }
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
    check();
    await finished(out);
    await rename(part, dest);
  } catch (err) {
    zip.terminate();
    out.destroy();
    await rm(part, { force: true });
    throw err;
  }
}
