import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Each log section's share of a report (they must all fit in it). */
export const LOG_SECTION_BYTES = 30 * 1024;

/**
 * The last `maxLines` lines of a text file, reading at most `maxBytes` from its
 * end (logs can be huge). Undefined when the file can't be read.
 */
export async function readTail(
  path: string,
  maxLines: number,
  maxBytes = 256 * 1024,
): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    let lines = buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n");
    // A cut-off first line is dropped, and so is the empty one after the last newline.
    if (length < size) lines = lines.slice(1);
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(-maxLines).join("\n");
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** The first `maxLines` lines of a text file (a crash report's head says what broke). */
export async function readHead(
  path: string,
  maxLines: number,
  maxBytes = 64 * 1024,
): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .slice(0, maxLines)
      .join("\n");
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** The newest file in `dir` (by modified time), if any. */
export async function newestFile(
  dir: string,
): Promise<{ path: string; modifiedAt: Date } | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  let newest: { path: string; modifiedAt: Date } | undefined;
  for (const name of names) {
    try {
      const info = await stat(join(dir, name));
      if (!info.isFile()) continue;
      if (!newest || info.mtime > newest.modifiedAt)
        newest = { path: join(dir, name), modifiedAt: info.mtime };
    } catch {
      // gone meanwhile
    }
  }
  return newest;
}
