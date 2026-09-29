/*
 * The only view of mod websites the rest of the app has. Nothing outside an
 * adapter (e.g. `modrinth.ts`) knows a site's URLs, ids or JSON shapes, so adding
 * another site means writing one new adapter.
 */

/** What a profile can run: its Minecraft version and the loaders it loads mods for. */
export interface ModTarget {
  gameVersion: string;
  /** A Quilt profile → `["quilt", "fabric"]`. */
  loaders: string[];
}

export interface RemoteProject {
  sourceId: string;
  projectId: string;
  slug: string;
  name: string;
  /** Empty when the site didn't say. */
  author: string;
  iconUrl?: string;
  pageUrl: string;
  /** How often it was downloaded, when the site says. */
  downloads?: number;
}

export interface RemoteFile {
  url: string;
  fileName: string;
  size: number;
  sha1: string;
  sha512?: string;
}

export interface RemoteDependency {
  projectId?: string;
  versionId?: string;
  kind: "required" | "optional" | "incompatible";
}

export interface RemoteVersion {
  sourceId: string;
  projectId: string;
  versionId: string;
  versionNumber: string;
  channel: "release" | "beta" | "alpha";
  loaders: string[];
  gameVersions: string[];
  file: RemoteFile;
  dependencies: RemoteDependency[];
}

export interface ModSource {
  /** Stored with each mod that came from here, e.g. `modrinth`. */
  id: string;
  displayName: string;
  /** Projects whose name or slug is exactly `query` (ignoring case), for this target. */
  findExact(
    query: string,
    target: ModTarget,
    signal?: AbortSignal,
  ): Promise<RemoteProject[]>;
  /** The newest version that fits the target: releases first, then betas, then alphas. */
  getCompatibleVersion(
    projectId: string,
    target: ModTarget,
    signal?: AbortSignal,
  ): Promise<RemoteVersion | null>;
  /** A version by id; its file is the one with `fileSha1` when given, else the main one. */
  getVersion(
    versionId: string,
    signal?: AbortSignal,
    fileSha1?: string,
  ): Promise<RemoteVersion>;
  /** Several projects by id at once (to name dependencies). */
  getProjects(ids: string[], signal?: AbortSignal): Promise<RemoteProject[]>;
  /** Which files (by SHA1) came from this site; unknown hashes are left out. */
  identifyFiles(
    sha1s: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, RemoteVersion>>;
  /** The page of a project, from its id. */
  pageUrl(projectId: string): string;
}
