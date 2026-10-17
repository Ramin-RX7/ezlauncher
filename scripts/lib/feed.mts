/**
 * releases.json helpers: the update feed the app reads (see src/shared/updates.ts).
 *
 * The feed workflow runs when a release is published. It passes the release's
 * files (from `gh release view --json assets`) and its SHA256SUMS.txt; each file
 * is matched to a kind of build by the end of its name (electron-builder.yml
 * names them).
 */
import { compareVersions, isPrerelease } from "../../src/shared/semver";
import type {
  FeedFile,
  FeedRelease,
  UpdateFeed,
  UpdateFileKind,
} from "../../src/shared/updates";

const SUFFIXES: [UpdateFileKind, string][] = [
  ["winSetup", "-setup.exe"],
  ["winPortableExe", "-portable.exe"],
  ["winPortableZip", "-portable.zip"],
  ["linuxAppImage", ".AppImage"],
];

export interface ReleaseAsset {
  name: string;
  size: number;
}

export interface ReleaseInput {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  notes: string;
  assets: readonly ReleaseAsset[];
  /** The text of SHA256SUMS.txt (`sha256sum` output). */
  sums: string;
  /** e.g. `https://github.com/Ramin-RX7/ezlauncher`. */
  repoUrl: string;
}

/** `sha256sum` lines: `<hex>  <name>` (or `<hex> *<name>` in binary mode). */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const [, hash, name] =
      /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim()) ?? [];
    if (hash && name) sums.set(name, hash.toLowerCase());
  }
  return sums;
}

export function releaseFiles(
  input: Pick<ReleaseInput, "version" | "assets" | "sums" | "repoUrl">,
): FeedRelease["files"] {
  const sums = parseSums(input.sums);
  const files: FeedRelease["files"] = {};
  for (const asset of input.assets) {
    const kind = SUFFIXES.find(([, suffix]) =>
      asset.name.endsWith(suffix),
    )?.[0];
    if (!kind) continue;
    if (files[kind])
      throw new Error(`Two ${kind} files: ${files[kind].name}, ${asset.name}`);
    const sha256 = sums.get(asset.name);
    if (!sha256)
      throw new Error(`SHA256SUMS.txt has no line for ${asset.name}`);
    const file: FeedFile = {
      name: asset.name,
      url: `${input.repoUrl}/releases/download/v${input.version}/${encodeURIComponent(asset.name)}`,
      size: asset.size,
      sha256,
    };
    files[kind] = file;
  }
  if (Object.keys(files).length === 0)
    throw new Error("The release has none of the app's files.");
  return files;
}

/** Add a release to the feed, or replace it when it's already there (a re-publish). Newest first. */
export function addRelease(
  feed: UpdateFeed | undefined,
  input: ReleaseInput,
): UpdateFeed {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
    throw new Error(`Not a date: ${input.date}`);
  const release: FeedRelease = {
    version: input.version,
    date: input.date,
    prerelease: isPrerelease(input.version),
    notes: input.notes.trim(),
    files: releaseFiles(input),
  };
  const others = (feed?.releases ?? []).filter(
    (r) => compareVersions(r.version, input.version) !== 0,
  );
  return {
    schema: 1,
    releases: [...others, release].sort((a, b) =>
      compareVersions(b.version, a.version),
    ),
  };
}

export function readFeed(text: string | undefined): UpdateFeed | undefined {
  if (text === undefined) return undefined;
  const feed = JSON.parse(text) as Partial<UpdateFeed>;
  if (feed.schema !== 1 || !Array.isArray(feed.releases))
    throw new Error("releases.json isn't a feed this script knows.");
  return feed as UpdateFeed;
}

export function writeFeed(feed: UpdateFeed): string {
  return JSON.stringify(feed, null, 2) + "\n";
}
