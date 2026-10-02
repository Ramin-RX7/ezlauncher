import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import { AppError } from "./errors";

/*
 * Stream a zip's entries to files without reading it all into memory. The caller
 * says where each entry goes (or skips it). Every file is written to a temporary
 * name first and then renamed into place, so an existing file at the target (maybe
 * a hard link into a store) is replaced, never written into.
 */

export interface UnzipOptions {
  /** Where an entry goes (its name has forward slashes), or undefined to skip it. Throw to stop. */
  target: (name: string) => string | undefined;
  /** Replace files that exist; otherwise an existing file stops the unzip. */
  overwrite?: boolean;
  /** Stops with `code` past this many bytes written (a zip bomb guard). */
  maxBytes?: number;
  /** Stops with `code` past this many files. */
  maxFiles?: number;
  /** The error code for an unreadable zip or one past the limits. */
  code: string;
  signal?: AbortSignal;
}

export interface UnzippedFile {
  /** The entry's name in the zip. */
  name: string;
  path: string;
  size: number;
  sha1: string;
}

/** Unpack a zip's entries where `target` says. Resolves to the files written, in zip order. */
export async function unzipEntries(
  zipFile: string,
  {
    target,
    overwrite = false,
    maxBytes = Infinity,
    maxFiles = Infinity,
    code,
    signal,
  }: UnzipOptions,
): Promise<UnzippedFile[]> {
  let failure: unknown;
  let bytes = 0;
  const written: UnzippedFile[] = [];
  /** Temporary files still open or not renamed yet, removed on failure. */
  const pending = new Set<string>();

  const unzip = new Unzip((file) => {
    if (failure) return;
    try {
      const isDir = file.name.endsWith("/");
      const path = target(isDir ? file.name.slice(0, -1) : file.name);
      if (path === undefined) return;
      if (isDir) {
        mkdirSync(path, { recursive: true });
        return;
      }
      if (written.length >= maxFiles)
        throw new AppError(code, "The file has too many entries.");
      if (!overwrite && existsSync(path))
        throw new AppError(code, `${file.name} is in the file twice.`);
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${randomBytes(4).toString("hex")}.part`;
      const fd = openSync(tmp, "wx");
      pending.add(tmp);
      const hash = createHash("sha1");
      let size = 0;
      let open = true;
      const close = () => {
        if (open) closeSync(fd);
        open = false;
      };
      file.ondata = (err, data, final) => {
        if (failure) {
          close();
          return;
        }
        try {
          if (err) throw new AppError(code, err.message, { cause: err });
          size += data.length;
          bytes += data.length;
          if (bytes > maxBytes)
            throw new AppError(code, "The file unpacks to too much data.");
          writeSync(fd, data);
          hash.update(data);
          if (final) {
            close();
            renameSync(tmp, path);
            pending.delete(tmp);
            written.push({
              name: file.name,
              path,
              size,
              sha1: hash.digest("hex"),
            });
          }
        } catch (e) {
          failure = e;
          close();
        }
      };
      file.start();
    } catch (e) {
      failure = e;
    }
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(zipFile)) {
      if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled.");
      unzip.push(chunk as Buffer);
      if (failure) break;
    }
    if (!failure) unzip.push(new Uint8Array(0), true);
  } catch (err) {
    failure ??= err;
  }
  if (failure) {
    for (const tmp of pending) rmSync(tmp, { force: true });
    if (failure instanceof AppError) throw failure;
    throw new AppError(code, "The file can't be read.", { cause: failure });
  }
  return written;
}
