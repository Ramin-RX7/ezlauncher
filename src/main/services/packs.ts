import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type {
  AddPacksResult,
  LibraryPack,
  PackDownloadProgress,
  PackSearchResult,
  Profile,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { Downloader } from "../minecraft/downloader";
import type { Paths } from "../minecraft/paths";
import {
  downloadPack,
  type PackDownloadKind,
} from "../modsources/downloadPack";
import type { ModSourceRegistry } from "../modsources/registry";
import type { ProjectType } from "../modsources/types";
import type {
  PackLibrary,
  PackMetaRecord,
  PackSourceRef,
} from "../profiles/packs/library";
import type { ProfileStore } from "../profiles/profiles";
import type { Runtime } from "./runtime";

/** What the resource pack, shader and data pack services get from the launcher service. */
export interface PackServiceDeps {
  paths: Paths;
  downloader: Downloader;
  sources: ModSourceRegistry;
  profiles: ProfileStore;
  runtime: Runtime;
  /** Resolves once startup (migration, first sync) is done. */
  whenReady: () => Promise<void>;
  requireProfile: (id: string) => Promise<Profile>;
  /** World, mod and pack sync for some (default: all) profiles. */
  sync: (only?: string[]) => Promise<void>;
  changed: () => void;
  /** An image from a site (`undefined` when the site says no). */
  fetchImage: (url: string) => Promise<Uint8Array | undefined>;
  logger: Logger;
}

type DownloadedPack = Awaited<ReturnType<typeof downloadPack>>;

/** What a download produced, for the kind to word its result. */
export interface InstalledPack<T> {
  /** The profile or world it was downloaded for. */
  target: T | undefined;
  download: DownloadedPack;
  meta: PackMetaRecord | undefined;
  /** Put into the target (turned on, made active, added). */
  placed: boolean;
  base: {
    sha1: string;
    name: string;
    versionNumber: string;
    otherVersion: boolean;
  };
}

/**
 * One kind of pack: its library, how it's found on a site, and what "use it" means
 * for its target (a profile for resource packs and shaders, a world for data packs).
 */
export interface PackKind<T, R> {
  library: PackLibrary;
  download: PackDownloadKind;
  /** Refusing to delete a pack that profiles or worlds still have. */
  inUse: { code: string; message: string };
  /** Refusing a second download of the same project. */
  busyMessage: string;
  /** The profile or world a call names (throws when it doesn't exist). */
  target: (id: string) => Promise<T>;
  gameVersion: (target: T) => string;
  progress: (p: PackDownloadProgress) => void;
  /** Save the site's project icon with a download. */
  projectIcon: boolean;
  /** Put stored packs into the target; throws an `AppError` when it can't now. */
  addTo: (target: T, sha1s: string[]) => Promise<void>;
  /** Use a downloaded pack in the target (default: `addTo`); throws when it can't now. */
  placeDownloaded?: (target: T, sha1: string) => Promise<void>;
  /** Throw when a profile or world that has the pack can't lose it now. */
  assertUsersIdle: (users: string[]) => Promise<void>;
  /** Inside the folder queue, before the library takes the pack out everywhere. */
  beforeRemove?: (users: string[], sha1: string) => Promise<void>;
  result: (installed: InstalledPack<T>) => Promise<R>;
}

/** One page of a kind of project on the first mod site, for a Minecraft version if given. */
export async function searchSite(
  sources: ModSourceRegistry,
  projectType: ProjectType,
  query: unknown,
  gameVersion: string | undefined,
  offset: number,
  /** Mods: only those for one of these loaders. */
  { loaders }: { loaders?: readonly string[] } = {},
): Promise<PackSearchResult> {
  const source = sources.sources[0];
  if (!source) return { hits: [], total: 0 };
  const page = await source.search(typeof query === "string" ? query : "", {
    projectType,
    ...(gameVersion !== undefined && { gameVersion }),
    ...(loaders && { loaders }),
    offset: Number.isFinite(offset) ? offset : 0,
    limit: 20,
  });
  return {
    total: page.total,
    hits: page.hits.map((p) => ({
      sourceId: p.sourceId,
      projectId: p.projectId,
      slug: p.slug,
      name: p.name,
      author: p.author,
      pageUrl: p.pageUrl,
      ...(p.description && { description: p.description }),
      ...(p.iconUrl && { iconUrl: p.iconUrl }),
      ...(p.downloads !== undefined && { downloads: p.downloads }),
      ...(p.loaders && { loaders: p.loaders }),
      ...(p.gameVersions && { gameVersions: p.gameVersions }),
    })),
  };
}

/** The library, add, remove, search and download work every kind of pack shares. */
export function createPackKindService<T, R>(
  deps: PackServiceDeps,
  kind: PackKind<T, R>,
) {
  const { downloader, sources, runtime, whenReady, changed } = deps;
  const { serialFs } = runtime;
  const { library } = kind;
  const projectType = kind.download.projectType;
  const notPackCode = kind.download.codes.notPack;
  const log = deps.logger;
  /** Downloads in progress, by project id. */
  const downloads = new Map<string, AbortController>();

  /**
   * Check picked or dropped paths (only existing `.zip` files) and add them to the
   * library. Resolves to the counts and the SHA1s of the stored zips.
   */
  async function addZips(files: readonly unknown[]): Promise<{
    result: AddPacksResult;
    stored: string[];
    storedNames: string[];
  }> {
    const result: AddPacksResult = { added: 0, existing: 0, failed: [] };
    const valid: string[] = [];
    for (const path of files) {
      const fileName = typeof path === "string" ? basename(path) : "?";
      try {
        if (
          typeof path !== "string" ||
          !isAbsolute(path) ||
          !/\.zip$/i.test(path) ||
          !(await stat(path)).isFile()
        )
          throw new AppError(notPackCode, "Not a pack zip.");
        valid.push(path);
      } catch {
        result.failed.push({ fileName, code: notPackCode });
      }
    }
    const added = await serialFs(() => library.add(valid));
    const stored: string[] = [];
    const storedNames: string[] = [];
    for (const item of added) {
      if (!item.ok) {
        result.failed.push({ fileName: item.fileName, code: item.code });
        continue;
      }
      if (item.added) result.added++;
      else result.existing++;
      stored.push(item.sha1);
      storedNames.push(item.fileName);
    }
    return { result, stored, storedNames };
  }

  /** A pack's icon from its project's page (small images only); failures are ignored. */
  async function saveIcon(sha1: string, url: string): Promise<void> {
    try {
      if (!url.startsWith("https://")) return;
      const bytes = await deps.fetchImage(url);
      if (bytes) await library.setIcon(sha1, bytes);
    } catch (err) {
      log.info(`fetching an icon failed: ${url}`, err);
    }
  }

  const place =
    kind.placeDownloaded ??
    ((target: T, sha1: string) => kind.addTo(target, [sha1]));

  return {
    list: async (): Promise<LibraryPack[]> => {
      await whenReady();
      await deps.sync();
      return library.list();
    },

    icon: (sha1: string) => library.icon(sha1),

    /**
     * Add pack zips to the library; with a target, also put them there. Paths come
     * from a file picker or drag and drop.
     */
    add: async (
      files: readonly unknown[],
      targetId?: string,
    ): Promise<AddPacksResult> => {
      await whenReady();
      const target = targetId ? await kind.target(targetId) : undefined;
      const { result, stored, storedNames } = await addZips(files);
      if (target !== undefined && stored.length > 0) {
        try {
          await kind.addTo(target, stored);
        } catch (err) {
          const code = err instanceof AppError ? err.code : "INTERNAL";
          for (const fileName of storedNames)
            result.failed.push({ fileName, code });
        }
      }
      changed();
      return result;
    },

    /** Delete a pack from the library and everywhere it is (`force` when it's in use). */
    remove: async (sha1: string, force: boolean): Promise<void> => {
      await whenReady();
      const users = await library.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError(kind.inUse.code, kind.inUse.message);
      // A running game keeps its packs open (locked on Windows).
      await kind.assertUsersIdle(users);
      await serialFs(async () => {
        await kind.beforeRemove?.(users, sha1);
        await library.remove(sha1);
      });
      changed();
    },

    removeUnused: async (): Promise<number> => {
      await whenReady();
      await deps.sync();
      const count = await serialFs(() => library.removeUnused());
      changed();
      return count;
    },

    /** Packs on the mod sites matching `query`, for the target's Minecraft version if given. */
    search: async (
      query: string,
      targetId: string | undefined,
      offset: number,
    ): Promise<PackSearchResult> => {
      const target = targetId ? await kind.target(targetId) : undefined;
      return searchSite(
        sources,
        projectType,
        query,
        target === undefined ? undefined : kind.gameVersion(target),
        offset,
      );
    },

    /** Download a pack into the library; with a target, use it there too. */
    install: async (
      sourceId: string,
      projectId: string,
      targetId?: string,
    ): Promise<R> => {
      await whenReady();
      const target = targetId ? await kind.target(targetId) : undefined;
      if (downloads.has(projectId))
        throw new AppError("BUSY", kind.busyMessage);
      const controller = new AbortController();
      downloads.set(projectId, controller);
      try {
        const download = await downloadPack(
          { downloader, library, source: sources.get(sourceId) },
          projectId,
          {
            ...(target !== undefined && {
              gameVersion: kind.gameVersion(target),
            }),
            kind: kind.download,
            signal: controller.signal,
            onProgress: (p) => {
              kind.progress({
                projectId,
                bytes: p.bytes,
                totalBytes: p.totalBytes,
              });
            },
          },
        );
        const sha1 = download.sha1;
        if (kind.projectIcon && download.project?.iconUrl)
          await saveIcon(sha1, download.project.iconUrl);
        const placed =
          target !== undefined &&
          (await place(target, sha1).then(
            () => true,
            () => false,
          ));
        const meta = await library.meta(sha1);
        changed();
        return await kind.result({
          target,
          download,
          meta,
          placed,
          base: {
            sha1,
            name: (meta?.fileName ?? download.version.file.fileName).replace(
              /\.zip$/i,
              "",
            ),
            versionNumber: download.version.versionNumber,
            otherVersion: download.otherVersion,
          },
        });
      } finally {
        downloads.delete(projectId);
      }
    },

    cancelInstall: (projectId: string): boolean => {
      const controller = downloads.get(projectId);
      controller?.abort();
      return controller !== undefined;
    },

    /** A download is running. */
    isBusy: (): boolean => downloads.size > 0,

    /**
     * Ask the mod sources about packs added by hand (Modrinth badge and page link).
     * Shaders have no icon of their own, so they get their project's. Resolves to
     * whether anything was asked.
     */
    identify: async (): Promise<boolean> => {
      const pending = await library.pendingIdentification();
      if (pending.length === 0) return false;
      const matches = new Map<
        string,
        { source: PackSourceRef; loaders: string[] }
      >();
      for (const source of sources.sources) {
        const left = pending.filter((sha1) => !matches.has(sha1));
        if (left.length === 0) break;
        const found = await source.identifyFiles(left);
        for (const [sha1, v] of found)
          matches.set(sha1, {
            source: {
              sourceId: v.sourceId,
              projectId: v.projectId,
              versionId: v.versionId,
              pageUrl: source.pageUrl(v.projectId, projectType),
            },
            loaders: v.loaders,
          });
        if (projectType === "shader" && found.size > 0) {
          const projects = await source
            .getProjects([
              ...new Set([...found.values()].map((v) => v.projectId)),
            ])
            .catch(() => []);
          for (const [sha1, v] of found) {
            const iconUrl = projects.find(
              (p) => p.projectId === v.projectId,
            )?.iconUrl;
            if (iconUrl) await saveIcon(sha1, iconUrl);
          }
        }
      }
      const found = await library.recordIdentification(pending, matches);
      log.info(`identified ${found} of ${pending.length} ${projectType}s`);
      return true;
    },
  };
}

export type PackKindService = ReturnType<typeof createPackKindService>;
