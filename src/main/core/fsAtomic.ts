import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";
import { AppError } from "./errors";

/**
 * Write a file so it is either fully old or fully new, never half-written:
 * write a temp file next to it, flush it to disk, then rename over the target.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** On Windows, antivirus or indexers can briefly lock the target; retry a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (
        attempt >= 5 ||
        (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")
      )
        throw err;
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
  }
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Read and validate a JSON file. Returns `undefined` if the file does not exist.
 * Throws `AppError('INVALID_JSON')` if it can't be parsed or doesn't match the schema.
 */
export async function readJson<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new AppError("INVALID_JSON", `${path} is not valid JSON.`, {
      cause: err,
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError("INVALID_JSON", `${path} has an unexpected format.`, {
      cause: result.error,
    });
  }
  return result.data;
}
