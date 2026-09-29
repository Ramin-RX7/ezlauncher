import { z } from "zod";
import type { PatchNotes } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Downloader } from "./downloader";
import type { Paths } from "./paths";

/*
 * Mojang's Java Edition patch notes (the feed the official launcher shows): an index
 * of every entry, and one file per entry with its HTML body. Entries never change, so
 * each is saved once; the index is fetched again when it doesn't know a version yet.
 */

export const PATCH_NOTES_BASE = "https://launchercontent.mojang.com/v2/";
export const PATCH_NOTES_INDEX_URL = `${PATCH_NOTES_BASE}javaPatchNotes.json`;
const INDEX_CACHE = "patch_notes_index.json";
/** Don't ask Mojang again for a version the index doesn't have for this long. */
const INDEX_RETRY_MS = 30 * 60 * 1000;

const indexSchema = z.looseObject({
  entries: z.array(
    z.looseObject({
      id: z.string(),
      version: z.string(),
      title: z.string(),
      type: z.string(),
      date: z.string(),
      contentPath: z.string(),
    }),
  ),
});
type Index = z.infer<typeof indexSchema>;
const cachedIndexSchema = z.object({
  fetchedAt: z.string(),
  index: indexSchema,
});

const entrySchema = z.looseObject({
  title: z.string(),
  version: z.string(),
  type: z.string(),
  date: z.string(),
  body: z.string(),
});

/** `contentPath` comes from the network: only plain relative paths under the feed. */
function entryUrl(contentPath: string): string {
  if (!/^[\w\-/.]+\.json$/.test(contentPath) || contentPath.includes(".."))
    throw new AppError("BAD_RESPONSE", "Unexpected patch notes path.");
  return new URL(contentPath, PATCH_NOTES_BASE).toString();
}

export function createPatchNotes({
  paths,
  downloader,
  now = () => Date.now(),
}: {
  paths: Paths;
  downloader: Downloader;
  now?: () => number;
}) {
  const indexFile = paths.launcherFile(INDEX_CACHE);

  async function fetchIndex(): Promise<Index> {
    const index = indexSchema.parse(
      JSON.parse(await downloader.fetchText(PATCH_NOTES_INDEX_URL)),
    );
    await writeJsonAtomic(indexFile, {
      fetchedAt: new Date(now()).toISOString(),
      index,
    });
    return index;
  }

  /** The index entry for a version: the saved index first, a fresh one if it's missing there. */
  async function findEntry(versionId: string) {
    const cached = await readJson(indexFile, cachedIndexSchema).catch(
      () => undefined,
    );
    const inCache = cached?.index.entries.find((e) => e.version === versionId);
    if (inCache) return inCache;
    if (cached && now() - Date.parse(cached.fetchedAt) < INDEX_RETRY_MS)
      return undefined;
    try {
      return (await fetchIndex()).entries.find((e) => e.version === versionId);
    } catch (err) {
      if (cached) return undefined; // offline: it isn't in what we have
      throw err;
    }
  }

  return {
    /** The patch notes of a version, or null when Mojang has none (e.g. before 1.13). */
    async get(versionId: string): Promise<PatchNotes | null> {
      const entry = await findEntry(versionId);
      if (!entry) return null;
      const file = paths.patchNotesEntry(entry.id);
      const saved = await readJson(file, entrySchema).catch(() => undefined);
      const data =
        saved ??
        entrySchema.parse(
          JSON.parse(await downloader.fetchText(entryUrl(entry.contentPath))),
        );
      if (!saved) await writeJsonAtomic(file, data);
      return {
        title: data.title,
        version: data.version,
        type: data.type,
        date: data.date,
        body: data.body,
      };
    },
  };
}
