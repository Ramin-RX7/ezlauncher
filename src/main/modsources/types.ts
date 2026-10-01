/*
 * The only view of mod websites the rest of the app has. Nothing outside an
 * adapter (e.g. `modrinth.ts`) knows a site's URLs, ids or JSON shapes, so adding
 * another site means writing one new adapter.
 */

/** The kinds of projects the launcher gets from a site. */
export type ProjectType = "mod" | "resourcepack";

/** What a profile can run: its Minecraft version and the loaders it loads mods for. */
export interface ModTarget {
  /** `""` = any version (only for picking a version). */
  gameVersion: string;
  /** A Quilt profile → `["quilt", "fabric"]`; resource packs → `["minecraft"]`. */
  loaders: string[];
  /** Missing = `mod`. */
  projectType?: ProjectType;
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
  /** The site's kind of project (e.g. `mod`, `resourcepack`), when it says. */
  projectType?: string;
  /** A one-line summary, when the site gives one. */
  description?: string;
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
  /** A page of projects matching `query` (best matches first), of one kind. */
  search(
    query: string,
    options: {
      projectType: ProjectType;
      /** Only projects with a version for this Minecraft version. */
      gameVersion?: string;
      offset: number;
      limit: number;
    },
    signal?: AbortSignal,
  ): Promise<{ hits: RemoteProject[]; total: number }>;
  /** The projects a project says it needs (any of its versions), with their kind. */
  projectDependencies(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<RemoteProject[]>;
  /** The page of a project, from its id or slug (and its kind: default `mod`). */
  pageUrl(projectId: string, projectType?: string): string;
}
