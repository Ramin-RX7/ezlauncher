import type { z } from "zod";
import { AppError } from "../../core/errors";
import type { Downloader } from "../downloader";

/** Fetch a JSON document from a loader server and validate it. */
export async function fetchJson<T extends z.ZodType>(
  downloader: Downloader,
  url: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const text = await downloader.fetchText(url, signal ? { signal } : {});
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new AppError("BAD_RESPONSE", `Invalid JSON from ${url}`, {
      cause: err,
    });
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError("BAD_RESPONSE", `Unexpected data from ${url}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
