/*
 * App updates: the feed format (`releases.json` at the repo root, written by the
 * feed workflow) and the update state the renderer shows.
 */

/** One file per kind of build; the feed names each release's files by these keys. */
export const UPDATE_FILE_KINDS = [
  "winSetup",
  "winPortableExe",
  "winPortableZip",
  "linuxAppImage",
] as const;
export type UpdateFileKind = (typeof UPDATE_FILE_KINDS)[number];

export interface FeedFile {
  name: string;
  url: string;
  size: number;
  /** Lowercase hex. */
  sha256: string;
}

export interface FeedRelease {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  prerelease: boolean;
  /** The version's CHANGELOG.md section (Markdown: `###` headings and `-` items). */
  notes: string;
  files: Partial<Record<UpdateFileKind, FeedFile>>;
}

export interface UpdateFeed {
  schema: 1;
  /** Newest first. */
  releases: FeedRelease[];
}

/** How this copy of the app was installed, which decides how it updates. */
export type BuildKind =
  | "dev"
  | "installer"
  | "portableExe"
  | "portableZip"
  | "appImage"
  /** A packaged build the launcher can't replace (e.g. Linux without the AppImage). */
  | "other";

/** Why an available update can't be installed from the app. */
export type UpdateBlock = "dev" | "unsupported" | "notWritable" | "noFile";

export interface UpdateNotes {
  version: string;
  date: string;
  notes: string;
}

export interface AvailableUpdate {
  version: string;
  date: string;
  /** Every newer release's notes, newest first. */
  notes: UpdateNotes[];
  /** Download size, when this build has a file in the release. */
  size?: number;
  /** Set when the update can only be downloaded by hand from the release page. */
  blocked?: UpdateBlock;
  /** The release page on GitHub. */
  pageUrl: string;
}

export type UpdateState =
  | { status: "idle"; checkedAt?: string }
  | { status: "checking"; checkedAt?: string }
  | { status: "upToDate"; checkedAt: string }
  | { status: "available"; checkedAt: string; update: AvailableUpdate }
  | {
      status: "downloading";
      checkedAt: string;
      update: AvailableUpdate;
      received: number;
      total: number;
    }
  | { status: "ready"; checkedAt: string; update: AvailableUpdate }
  | { status: "installing"; checkedAt: string; update: AvailableUpdate }
  | {
      status: "error";
      checkedAt?: string;
      /** An `AppError` code. */
      code: string;
      /** The update that was being downloaded or installed, if any. */
      update?: AvailableUpdate;
    };

export interface UpdatePrefs {
  /** Check for updates once a day. */
  autoCheck: boolean;
}
