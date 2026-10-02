import { mkdir } from "node:fs/promises";
import type { Downloader, DownloadProgress } from "../minecraft/downloader";
import type { Paths } from "../minecraft/paths";
import { installPackFiles } from "./installFiles";
import type { PackManifest } from "./manifest";
import type { MrpackContents } from "./readMrpack";
import { extractOverrides } from "./readMrpack";

export type ImportStep = "download" | "overrides";

export interface ImportOptions {
  /** The `.mrpack` file. */
  file: string;
  contents: MrpackContents;
  /** The folder to fill (new and empty). */
  gameDir: string;
  /** Optional files to leave out. */
  skip: ReadonlySet<string>;
  signal?: AbortSignal;
  onProgress?: (step: ImportStep, p: DownloadProgress) => void;
}

/**
 * Fill a new game folder from a pack: its downloads first, then its overrides on
 * top (they win). Resolves to the manifest's file list. The caller owns the folder
 * and removes it on failure.
 */
export async function importPackFiles(
  deps: { paths: Paths; downloader: Pick<Downloader, "run"> },
  { file, contents, gameDir, skip, signal, onProgress }: ImportOptions,
): Promise<Pick<PackManifest, "files" | "skipped">> {
  await mkdir(gameDir, { recursive: true });
  const files = contents.index.files.filter(
    (f) => !(f.optional && skip.has(f.path)),
  );
  await installPackFiles(deps, gameDir, files, {
    ...(signal && { signal }),
    onProgress: (p) => onProgress?.("download", p),
  });
  onProgress?.("overrides", {
    files: 0,
    totalFiles: 0,
    bytes: 0,
    totalBytes: 0,
  });
  const overrides = await extractOverrides(file, gameDir, {
    ...(signal && { signal }),
  });
  const manifestFiles: Record<string, string> = {};
  for (const f of files) manifestFiles[f.path] = f.sha1;
  for (const [path, sha1] of overrides) manifestFiles[path] = sha1;
  return {
    files: manifestFiles,
    skipped: contents.index.files
      .filter((f) => f.optional && skip.has(f.path))
      .map((f) => f.path),
  };
}
