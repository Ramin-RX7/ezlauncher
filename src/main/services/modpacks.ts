import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  PROFILE_NAME_MAX,
  type ModpackExportOptions,
  type ModpackExportResult,
  type ModpackPreview,
  type ModpackProgress,
  type ModpackUpdatePlan,
  type ModpackUpdateResult,
  type ModpackVersion,
  type Profile,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { Downloader, DownloadProgress } from "../minecraft/downloader";
import { safeId, safeJoin, type Paths } from "../minecraft/paths";
import { exportEntries, exportModpack } from "../modpacks/exportPack";
import { importPackFiles } from "../modpacks/importPack";
import { isLibraryPath } from "../modpacks/installFiles";
import {
  readManifest,
  removeManifest,
  writeManifest,
  type PackManifest,
} from "../modpacks/manifest";
import {
  assertSupported,
  SUPPORTED_LOADERS,
  type PackRequirements,
} from "../modpacks/mrpackIndex";
import { readMrpack, type MrpackContents } from "../modpacks/readMrpack";
import {
  applyUpdate,
  planUpdate,
  type UpdatePlan,
} from "../modpacks/updatePack";
import type { ModSourceRegistry } from "../modsources/registry";
import type { RemoteVersion } from "../modsources/types";
import { removeTree } from "../profiles/links";
import type { ProfileStore } from "../profiles/profiles";
import { exists } from "../profiles/linkedStore";

/*
 * Mod packs (Modrinth `.mrpack`): import one as a new profile, update a profile to
 * another version of its pack, export a profile as a pack. The work is in
 * `modpacks/`; this wires it to profiles, the libraries and the mod sites.
 */

const PENDING_TTL_MS = 60 * 60 * 1000;
const MAX_PACK_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ICON = 2 * 1024 * 1024;
/** The keys a pack's index uses for each loader. */
const LOADER_KEY: Record<string, string> = {
  fabric: "fabric-loader",
  quilt: "quilt-loader",
};
const LOADER_VERSION = /^[\w.+-]{1,64}$/;

interface Remote {
  sourceId: string;
  projectId: string;
  versionId: string;
  iconUrl?: string;
}

/** A pack file read and waiting to be imported (or used for an update). */
interface Pending {
  file: string;
  contents: MrpackContents;
  /** Downloaded by the launcher: deleted once it's no longer needed. */
  temp: boolean;
  remote?: Remote;
  createdAt: number;
}

interface PendingUpdate {
  profileId: string;
  plan: UpdatePlan;
  contents: MrpackContents;
  manifest: PackManifest;
  pending: Pending;
  createdAt: number;
}

export interface ModpackServiceDeps {
  paths: Paths;
  downloader: Downloader;
  profiles: ProfileStore;
  sources: ModSourceRegistry;
  requireProfile: (id: string) => Promise<Profile>;
  assertNotRunning: (profileId: string) => void;
  /** Profiles being changed by an update: they can't be played meanwhile. */
  busy: Set<string>;
  /** Folder work, one at a time. */
  serialFs: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Adopt the profile's files into the libraries. */
  sync: (only: string[]) => Promise<void>;
  /** Forget a removed profile in every library. */
  forgetProfile: (profileId: string) => Promise<void>;
  /** The loader build to name in an export when the profile doesn't pin one. */
  loaderVersionOf: (profile: Profile) => Promise<string | undefined>;
  fetchImage: (url: string) => Promise<Uint8Array | undefined>;
  progress: (p: ModpackProgress) => void;
  changed: () => void;
  logger: Logger;
}

const isSupported = (requires: PackRequirements) =>
  requires.loader === null || SUPPORTED_LOADERS.includes(requires.loader);

/** A pack's version and loader must fit a profile record. */
function checkRequirements(requires: PackRequirements): void {
  try {
    safeId(requires.gameVersion);
  } catch {
    throw new AppError(
      "MODPACK_INVALID",
      `The mod pack names an odd Minecraft version: ${requires.gameVersion}`,
    );
  }
  if (
    requires.loaderVersion !== undefined &&
    !LOADER_VERSION.test(requires.loaderVersion)
  )
    throw new AppError(
      "MODPACK_INVALID",
      `The mod pack names an odd loader build: ${requires.loaderVersion}`,
    );
}

function profileLoader(requires: PackRequirements): Profile["loader"] {
  if (!requires.loader) return null;
  return {
    id: requires.loader,
    ...(requires.loaderVersion !== undefined && {
      version: requires.loaderVersion,
    }),
  };
}

function profileName(value: unknown, fallback: string): string {
  const name = (typeof value === "string" ? value : fallback).trim();
  return (name || fallback.trim() || "Mod pack")
    .slice(0, PROFILE_NAME_MAX)
    .trim();
}

/** Values from the renderer: anything that isn't a string matches nothing. */
const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : undefined;

export function createModpackService(deps: ModpackServiceDeps) {
  const { paths, downloader, profiles, sources, logger: log } = deps;
  const pending = new Map<string, Pending>();
  const updates = new Map<string, PendingUpdate>();
  /** Downloads and imports in progress, by token (or version id while fetching). */
  const jobs = new Map<string, AbortController>();

  async function forget(token: string): Promise<void> {
    const p = pending.get(token);
    pending.delete(token);
    if (p?.temp && ![...pending.values()].some((o) => o.file === p.file))
      await rm(p.file, { force: true });
  }

  async function forgetUpdate(token: string): Promise<void> {
    const u = updates.get(token);
    if (!u) return;
    updates.delete(token);
    await removeTree(u.plan.stagingDir).catch(() => undefined);
    if (u.pending.temp) await rm(u.pending.file, { force: true });
  }

  /** Forget pack files and update plans left alone for an hour. */
  async function expire(): Promise<void> {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [token, p] of pending)
      if (p.createdAt < cutoff && !jobs.has(token)) await forget(token);
    for (const [token, u] of updates)
      if (u.createdAt < cutoff && !jobs.has(token)) await forgetUpdate(token);
  }

  function take(token: unknown): Pending {
    const p = typeof token === "string" ? pending.get(token) : undefined;
    if (!p)
      throw new AppError(
        "MODPACK_GONE",
        "Open the mod pack again; it was put away.",
      );
    return p;
  }

  function track<T>(
    key: string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (jobs.has(key)) throw new AppError("BUSY", "This is already running.");
    const controller = new AbortController();
    jobs.set(key, controller);
    return fn(controller.signal).finally(() => jobs.delete(key));
  }

  const report =
    (token: string, step: ModpackProgress["step"]) => (p: DownloadProgress) => {
      deps.progress({ token, step, ...p });
    };

  function preview(token: string, p: Pending): ModpackPreview {
    const { index, overrides } = p.contents;
    const { requires } = index;
    return {
      token,
      name: index.name,
      versionNumber: index.versionNumber,
      ...(index.summary && { summary: index.summary }),
      gameVersion: requires.gameVersion,
      loader: requires.loader,
      ...(requires.loaderVersion !== undefined && {
        loaderVersion: requires.loaderVersion,
      }),
      supported: isSupported(requires),
      files: index.files.length,
      downloadBytes: index.files.reduce((n, f) => n + f.size, 0),
      included: overrides.length,
      includedBytes: overrides.reduce((n, o) => n + o.size, 0),
      optional: index.files
        .filter((f) => f.optional)
        .map((f) => ({ path: f.path, size: f.size })),
      ...(p.remote?.iconUrl && { iconUrl: p.remote.iconUrl }),
    };
  }

  async function open(
    file: string,
    temp: boolean,
    remote?: Remote,
  ): Promise<{ token: string; entry: Pending }> {
    await expire();
    const contents = await readMrpack(file);
    checkRequirements(contents.index.requires);
    const token = randomUUID();
    const entry: Pending = {
      file,
      contents,
      temp,
      ...(remote && { remote }),
      createdAt: Date.now(),
    };
    pending.set(token, entry);
    return { token, entry };
  }

  /** A site's pack version: its `.mrpack` file. */
  function packFile(v: RemoteVersion) {
    if (!/\.mrpack$/i.test(v.file.fileName))
      throw new AppError(
        "MODPACK_INVALID",
        "This version has no Modrinth mod pack file.",
      );
    if (v.file.size > MAX_PACK_BYTES)
      throw new AppError("MODPACK_TOO_BIG", "The mod pack is too big.");
    return v.file;
  }

  /** Download a pack version (SHA1-checked) and read it. */
  async function fetchRemote(
    sourceId: string,
    projectId: string,
    versionId: string,
  ): Promise<{ token: string; entry: Pending }> {
    const source = sources.get(sourceId);
    return track(versionId, async (signal) => {
      const version = await source.getVersion(versionId, signal);
      if (version.projectId !== projectId)
        throw new AppError(
          "MODPACK_INVALID",
          "That version is another pack's.",
        );
      const file = packFile(version);
      const dest = paths.modpackDownload(file.sha1);
      if (!(await exists(dest))) {
        await mkdir(paths.modpackDownloadsDir, { recursive: true });
        await downloader.run(
          [{ dest, url: file.url, sha1: file.sha1, size: file.size }],
          { signal, onProgress: report(versionId, "fetch") },
        );
      }
      const iconUrl = (
        await source.getProjects([projectId], signal).catch(() => [])
      )[0]?.iconUrl;
      return open(dest, true, {
        sourceId,
        projectId,
        versionId,
        ...(iconUrl && { iconUrl }),
      });
    });
  }

  /** A pack's versions on its site, newest first (only those with a pack file). */
  async function versions(options: {
    sourceId: string;
    projectId: string;
  }): Promise<ModpackVersion[]> {
    const source = sources.get(asString(options.sourceId));
    const list = await source.listVersions(asString(options.projectId));
    return list
      .filter((v) => /\.mrpack$/i.test(v.file.fileName))
      .map((v) => ({
        versionId: v.versionId,
        versionNumber: v.versionNumber,
        channel: v.channel,
        gameVersions: v.gameVersions,
        loaders: v.loaders,
        ...(v.published && { published: v.published }),
        size: v.file.size,
      }));
  }

  async function saveIcon(profileId: string, url: string): Promise<boolean> {
    if (!url.startsWith("https://")) return false;
    const image = await deps.fetchImage(url).catch(() => undefined);
    if (!image || image.length === 0 || image.length > MAX_ICON) return false;
    await mkdir(dirname(paths.profileIcon(profileId)), { recursive: true });
    await writeFile(paths.profileIcon(profileId), image);
    return true;
  }

  return {
    /** Remove what an interrupted import or update left (at startup). */
    async cleanUp(): Promise<void> {
      let names: string[] = [];
      try {
        names = await readdir(paths.profilesDir);
      } catch {
        // no profiles yet
      }
      for (const name of names)
        if (/^\.(import|update)-/.test(name))
          await removeTree(join(paths.profilesDir, name)).catch(
            () => undefined,
          );
      await rm(paths.modpackDownloadsDir, { recursive: true, force: true });
    },

    /** Read a `.mrpack` the user picked or dropped. */
    async inspectFile(path: unknown): Promise<ModpackPreview> {
      if (
        typeof path !== "string" ||
        !isAbsolute(path) ||
        !/\.mrpack$/i.test(path)
      )
        throw new AppError("MODPACK_INVALID", "Choose a .mrpack file.");
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile())
        throw new AppError("MODPACK_INVALID", "Choose a .mrpack file.");
      const { token, entry } = await open(path, false);
      return preview(token, entry);
    },

    /** Download a version of a pack from a site and read it. */
    async inspectRemote(options: {
      sourceId: string;
      projectId: string;
      versionId: string;
    }): Promise<ModpackPreview> {
      const { token, entry } = await fetchRemote(
        asString(options.sourceId),
        asString(options.projectId),
        asString(options.versionId),
      );
      return preview(token, entry);
    },

    versions,

    /** Import a read pack as a new profile. `skip`: optional files left out. */
    async importPack(options: {
      token: string;
      name?: string;
      skip?: string[];
    }): Promise<Profile> {
      const entry = take(options.token);
      const token = options.token;
      const { index } = entry.contents;
      assertSupported(index.requires);
      const optional = new Set(
        index.files.filter((f) => f.optional).map((f) => f.path),
      );
      const skip = new Set(
        (Array.isArray(options.skip) ? options.skip : []).filter(
          (p): p is string => typeof p === "string" && optional.has(p),
        ),
      );
      const id = randomUUID();
      const staging = paths.modpackImportDir(id);
      const gameDir = paths.gameDir(id);
      let added = false;
      return track(token, async (signal) => {
        try {
          const result = await importPackFiles(
            { paths, downloader },
            {
              file: entry.file,
              contents: entry.contents,
              gameDir: staging,
              skip,
              signal,
              onProgress: (step, p) => {
                deps.progress({ token, step, ...p });
              },
            },
          );
          deps.progress({
            token,
            step: "finish",
            files: 0,
            totalFiles: 0,
            bytes: 0,
            totalBytes: 0,
          });
          await deps.serialFs(() => rename(staging, gameDir));
          const remote = entry.remote;
          await writeManifest(paths, id, {
            schema: 1,
            name: index.name,
            versionNumber: index.versionNumber,
            ...(remote && {
              source: {
                sourceId: remote.sourceId,
                projectId: remote.projectId,
                versionId: remote.versionId,
              },
            }),
            ...result,
          });
          const customIcon = remote?.iconUrl
            ? await saveIcon(id, remote.iconUrl)
            : false;
          const profile = await profiles.add({
            id,
            name: profileName(options.name, index.name),
            gameVersion: index.requires.gameVersion,
            loader: profileLoader(index.requires),
            createdAt: new Date().toISOString(),
            modpack: {
              name: index.name.slice(0, 256),
              versionNumber: index.versionNumber,
              ...(remote && {
                sourceId: remote.sourceId,
                projectId: remote.projectId,
                versionId: remote.versionId,
              }),
            },
            ...(customIcon && { customIcon: true }),
          });
          added = true;
          await deps.sync([id]); // the pack's mods, packs and worlds enter the libraries
          log.info(
            `imported mod pack ${index.name} ${index.versionNumber} as ${id}`,
          );
          await forget(token);
          deps.changed();
          return profile;
        } catch (err) {
          await deps.serialFs(async () => {
            await removeTree(staging).catch(() => undefined);
            await removeTree(gameDir).catch(() => undefined);
            await removeManifest(paths, id);
            await rm(paths.profileIcon(id), { force: true });
            if (added) {
              await deps.forgetProfile(id);
              await profiles.remove(id);
            }
          });
          if (added) deps.changed();
          throw err;
        }
      });
    },

    /** Stop a download or import; an import leaves nothing behind. */
    cancel(token: string): boolean {
      const controller = jobs.get(asString(token));
      controller?.abort();
      return controller !== undefined;
    },

    /** Put away a read pack the user didn't import. */
    async discard(token: string): Promise<void> {
      if (!jobs.has(asString(token))) await forget(asString(token));
    },

    // ---- Updates ----

    /** The versions a pack profile can move to (from its site). */
    async updateVersions(profileId: string): Promise<ModpackVersion[]> {
      const profile = await deps.requireProfile(profileId);
      const pack = profile.modpack;
      if (!pack?.sourceId || !pack.projectId)
        throw new AppError(
          "MODPACK_NO_SOURCE",
          "This profile's mod pack didn't come from a site.",
        );
      return versions({ sourceId: pack.sourceId, projectId: pack.projectId });
    },

    /**
     * Work out an update to a version from the profile's site (`versionId`) or a
     * pack file read before (`token`). Nothing changes until it's applied.
     */
    async planUpdate(options: {
      profileId: string;
      versionId?: string;
      token?: string;
    }): Promise<ModpackUpdatePlan> {
      const profile = await deps.requireProfile(options.profileId);
      deps.assertNotRunning(profile.id);
      const manifest = await readManifest(paths, profile.id);
      if (!profile.modpack || !manifest)
        throw new AppError(
          "MODPACK_NO_MANIFEST",
          "This profile doesn't come from a mod pack.",
        );
      let entry: Pending;
      let token: string;
      if (options.token !== undefined) {
        entry = take(options.token);
        token = options.token;
        pending.delete(token); // it belongs to the update now
      } else {
        const { sourceId, projectId } = profile.modpack;
        if (!sourceId || !projectId || typeof options.versionId !== "string")
          throw new AppError(
            "MODPACK_NO_SOURCE",
            "This profile's mod pack didn't come from a site.",
          );
        ({ token, entry } = await fetchRemote(
          sourceId,
          projectId,
          options.versionId,
        ));
        pending.delete(token);
      }
      const { index } = entry.contents;
      const stagingDir = paths.modpackStagingDir(profile.id, token);
      try {
        const plan = await track(token, (signal) =>
          planUpdate({
            file: entry.file,
            contents: entry.contents,
            manifest,
            gameDir: paths.gameDir(profile.id),
            stagingDir,
            signal,
          }),
        );
        updates.set(token, {
          profileId: profile.id,
          plan,
          contents: entry.contents,
          manifest,
          pending: entry,
          createdAt: Date.now(),
        });
        return {
          token,
          from: profile.modpack.versionNumber,
          to: index.versionNumber,
          gameVersion: {
            from: profile.gameVersion,
            to: index.requires.gameVersion,
          },
          loader: {
            from: profile.loader?.id ?? null,
            to: index.requires.loader,
          },
          items: plan.items,
          supported: isSupported(index.requires),
        };
      } catch (err) {
        await removeTree(stagingDir).catch(() => undefined);
        if (entry.temp) await rm(entry.file, { force: true });
        throw err;
      }
    },

    /** Carry out a planned update. `replace`: the "changed by you" files to replace anyway. */
    async applyUpdate(options: {
      token: string;
      replace?: string[];
    }): Promise<ModpackUpdateResult> {
      const token = asString(options.token);
      const update = updates.get(token);
      if (!update)
        throw new AppError(
          "MODPACK_GONE",
          "Check for the update again; it was put away.",
        );
      const { profileId, plan, contents, manifest } = update;
      const { index } = contents;
      assertSupported(index.requires);
      const profile = await deps.requireProfile(profileId);
      deps.assertNotRunning(profileId);
      if (deps.busy.has(profileId))
        throw new AppError("BUSY", "This profile is being updated.");
      const changedPaths = new Set(
        plan.items.filter((i) => i.action === "changed").map((i) => i.path),
      );
      const replace = new Set(
        (Array.isArray(options.replace) ? options.replace : []).filter(
          (p): p is string => typeof p === "string" && changedPaths.has(p),
        ),
      );
      deps.busy.add(profileId);
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const result = await track(token, (signal) =>
          deps.serialFs(() =>
            applyUpdate(
              { paths, downloader },
              {
                plan,
                gameDir: paths.gameDir(profileId),
                replace,
                backupFile: paths.modpackBackupFile(profileId, stamp),
                signal,
                onProgress: report(token, "download"),
              },
            ),
          ),
        );
        const remote = update.pending.remote;
        const source = remote
          ? {
              sourceId: remote.sourceId,
              projectId: remote.projectId,
              versionId: remote.versionId,
            }
          : manifest.source;
        await writeManifest(paths, profileId, {
          schema: 1,
          name: index.name,
          versionNumber: index.versionNumber,
          ...(source && { source }),
          files: plan.target,
          skipped: manifest.skipped,
        });
        await profiles.setPack(profileId, {
          gameVersion: index.requires.gameVersion,
          loader: profileLoader(index.requires),
          modpack: {
            name: index.name.slice(0, 256),
            versionNumber: index.versionNumber,
            ...(profile.modpack?.sourceId && {
              sourceId: profile.modpack.sourceId,
            }),
            ...(profile.modpack?.projectId && {
              projectId: profile.modpack.projectId,
            }),
            ...(source && { versionId: source.versionId }),
          },
        });
        log.info(
          `updated ${profileId} to ${index.name} ${index.versionNumber}: +${result.added} ~${result.updated} -${result.removed}`,
        );
        return result;
      } finally {
        deps.busy.delete(profileId);
        await forgetUpdate(token);
        await deps.sync([profileId]).catch((err: unknown) => {
          log.warn(`sync after updating ${profileId} failed`, err);
        });
        deps.changed();
      }
    },

    async discardUpdate(token: string): Promise<void> {
      if (!jobs.has(asString(token))) await forgetUpdate(asString(token));
    },

    // ---- Export ----

    async exportOptions(profileId: string): Promise<ModpackExportOptions> {
      const profile = await deps.requireProfile(profileId);
      return {
        entries: await exportEntries(paths.gameDir(profile.id)),
        name: profile.modpack?.name ?? profile.name,
        versionNumber: profile.modpack?.versionNumber ?? "1.0.0",
      };
    },

    /** Write a profile as a `.mrpack` to `dest` (chosen in a save dialog). */
    async exportPack(
      profileId: string,
      options: {
        name: string;
        versionNumber: string;
        summary?: string;
        include: string[];
      },
      dest: string,
    ): Promise<ModpackExportResult> {
      const profile = await deps.requireProfile(profileId);
      const name = text(options.name, 256);
      const versionNumber = text(options.versionNumber, 256);
      if (!name || !versionNumber)
        throw new AppError(
          "INVALID_INPUT",
          "Give the pack a name and a version.",
        );
      const include = (Array.isArray(options.include) ? options.include : [])
        .filter((n): n is string => typeof n === "string")
        .slice(0, 1000);
      const dependencies: Record<string, string> = {
        minecraft: profile.gameVersion,
      };
      if (profile.loader) {
        const key = LOADER_KEY[profile.loader.id];
        const version =
          profile.loader.version ?? (await deps.loaderVersionOf(profile));
        if (!key || !version)
          throw new AppError(
            "MODPACK_LOADER_UNKNOWN",
            "Play the profile once first, so its loader build is known.",
          );
        dependencies[key] = version;
      }
      const source = sources.sources[0];
      const summary = text(options.summary, 4096);
      const result = await exportModpack(paths, {
        gameDir: paths.gameDir(profile.id),
        include,
        name,
        versionNumber,
        ...(summary && { summary }),
        dependencies,
        identify: async (sha1s) => {
          const urls = new Map<string, string>();
          if (!source || sha1s.length === 0) return urls;
          for (const [sha1, v] of await source.identifyFiles(sha1s))
            urls.set(sha1, v.file.url);
          return urls;
        },
        dest,
      });
      log.info(
        `exported ${profile.id} as a mod pack: ${result.downloads} links, ${result.included} files`,
      );
      return result;
    },

    // ---- Profile hooks ----

    /** A deleted profile's pack record and icon go too. */
    async forgetProfile(profileId: string): Promise<void> {
      await removeManifest(paths, profileId);
      await rm(paths.profileIcon(profileId), { force: true });
    },

    /**
     * A duplicated pack profile stays a pack profile: the copy gets the manifest, the
     * icon, and the pack's other files (configs…); the libraries' files and worlds
     * were already handled by the duplicate.
     */
    async copyTo(from: Profile, to: Profile): Promise<void> {
      if (from.customIcon) {
        await cp(paths.profileIcon(from.id), paths.profileIcon(to.id)).catch(
          () => undefined,
        );
      }
      const manifest = from.modpack
        ? await readManifest(paths, from.id)
        : undefined;
      if (manifest) {
        await writeManifest(paths, to.id, manifest);
        for (const path of Object.keys(manifest.files)) {
          if (isLibraryPath(paths, path) || /^saves(\/|$)/i.test(path))
            continue;
          const src = safeJoin(paths.gameDir(from.id), path);
          const dest = safeJoin(paths.gameDir(to.id), path);
          if (!(await exists(src)) || (await exists(dest))) continue;
          await mkdir(dirname(dest), { recursive: true });
          await cp(src, dest).catch((err: unknown) => {
            log.warn(`copying ${path} to ${to.id} failed`, err);
          });
        }
      }
      if (from.modpack || from.customIcon)
        await profiles.setPack(to.id, {
          ...(from.modpack && { modpack: from.modpack }),
          ...(from.customIcon && { customIcon: true }),
        });
    },
  };
}

export type ModpackService = ReturnType<typeof createModpackService>;
