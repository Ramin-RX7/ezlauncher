import { z } from "zod";
import { compareVersions, isSemver } from "@shared/semver";
import {
  UPDATE_FILE_KINDS,
  type AvailableUpdate,
  type BuildKind,
  type FeedFile,
  type UpdateFeed,
  type UpdateFileKind,
} from "@shared/updates";

export const REPO_URL = "https://github.com/Ramin-RX7/ezlauncher";
/** `releases.json` on master, written by the feed workflow when a release is published. */
export const FEED_URL =
  "https://raw.githubusercontent.com/Ramin-RX7/ezlauncher/master/releases.json";
/** Updates come only from this repo's releases (GitHub redirects them to its file host). */
const DOWNLOAD_PREFIX = `${REPO_URL}/releases/download/`;

const fileSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.url(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const releaseSchema = z.object({
  version: z.string().refine(isSemver),
  date: z.string(),
  prerelease: z.boolean().optional().default(false),
  notes: z.string().max(100_000).optional().default(""),
  // An unknown or broken file only drops that file, never the release.
  files: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .transform((files) => {
      const out: Partial<Record<UpdateFileKind, FeedFile>> = {};
      for (const kind of UPDATE_FILE_KINDS) {
        const parsed = fileSchema.safeParse(files[kind]);
        if (parsed.success) out[kind] = parsed.data;
      }
      return out;
    }),
});

const feedSchema = z.object({
  schema: z.literal(1),
  releases: z.array(z.unknown()).transform((list) =>
    list.flatMap((r) => {
      const parsed = releaseSchema.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** Read the feed; releases that don't parse are left out. Throws when it isn't a feed at all. */
export function parseFeed(text: string): UpdateFeed {
  return feedSchema.parse(JSON.parse(text));
}

/** The feed file each build downloads. */
export const FILE_FOR_BUILD: Partial<Record<BuildKind, UpdateFileKind>> = {
  installer: "winSetup",
  portableExe: "winPortableExe",
  portableZip: "winPortableZip",
  appImage: "linuxAppImage",
};

export function isAllowedDownload(url: string, allowAny = false): boolean {
  return allowAny || url.startsWith(DOWNLOAD_PREFIX);
}

export interface PickedUpdate {
  update: AvailableUpdate;
  /** What to download, when this build can update itself from the feed. */
  file?: FeedFile;
}

/**
 * The newest stable release newer than `current`, with the notes of every
 * stable release in between. Undefined when this version is the newest.
 */
export function pickUpdate(
  feed: UpdateFeed,
  current: string,
  build: BuildKind,
  { allowAnyUrl = false }: { allowAnyUrl?: boolean } = {},
): PickedUpdate | undefined {
  const newer = feed.releases
    .filter((r) => !r.prerelease && compareVersions(r.version, current) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = newer[0];
  if (!latest) return undefined;

  const kind = FILE_FOR_BUILD[build];
  const candidate = kind ? latest.files[kind] : undefined;
  const file =
    candidate && isAllowedDownload(candidate.url, allowAnyUrl)
      ? candidate
      : undefined;
  const update: AvailableUpdate = {
    version: latest.version,
    date: latest.date,
    notes: newer.map((r) => ({
      version: r.version,
      date: r.date,
      notes: r.notes,
    })),
    pageUrl: `${REPO_URL}/releases/tag/v${latest.version}`,
    ...(file && { size: file.size }),
  };
  if (build === "dev") update.blocked = "dev";
  else if (!kind) update.blocked = "unsupported";
  else if (!file) update.blocked = "noFile";
  return { update, ...(file && { file }) };
}
