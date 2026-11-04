import type {
  InstalledVersionInfo,
  InstallProgress,
  LoaderBuildInfo,
  LoaderInfo,
  PatchNotes,
  Profile,
  VersionListResult,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { Downloader } from "../minecraft/downloader";
import {
  deleteVersion,
  isInstalled,
  listDependents,
  readInstallMarker,
  type installVersion,
  type InstalledVersion,
  type InstallMode,
} from "../minecraft/installer";
import type { InstallQueue } from "../minecraft/installQueue";
import type {
  installLoader,
  LoaderInstallRequest,
  prepareLoader,
} from "../minecraft/loaders/installLoader";
import {
  getSupportedGameVersions,
  type LoaderRegistry,
} from "../minecraft/loaders/registry";
import { getVersionList, listInstalledVersions } from "../minecraft/manifest";
import { safeId, type Paths } from "../minecraft/paths";
import type { createPatchNotes } from "../minecraft/patchNotes";
import type { Platform } from "../minecraft/platform";
import type { ProfileStore } from "../profiles/profiles";
import type { Runtime } from "./runtime";

export interface VersionServiceDeps {
  paths: Paths;
  downloader: Downloader;
  platform: Platform;
  loaders: LoaderRegistry;
  /** Installs run one at a time per version; its events go to the renderer. */
  queue: InstallQueue;
  patchNotes: ReturnType<typeof createPatchNotes>;
  profiles: Pick<ProfileStore, "list">;
  runtime: Runtime;
  /** Resolves once startup (migration, first sync) is done. */
  whenReady: () => Promise<void>;
  /** Resolves once a Java install from Settings (if any) is over. */
  afterJava: () => Promise<void>;
  /** The installers (the real ones; tests pass fakes). */
  install: {
    version: typeof installVersion;
    loader: typeof installLoader;
    prepareLoader: typeof prepareLoader;
  };
  progress: (p: InstallProgress) => void;
  changed: () => void;
  logger: Logger;
}

/** Minecraft versions and loaders: list, install, repair, delete, and the install each profile plays. */
export function createVersionService(deps: VersionServiceDeps) {
  const {
    paths,
    downloader,
    platform,
    loaders,
    queue,
    patchNotes,
    profiles,
    whenReady,
    afterJava,
    install,
    changed,
  } = deps;
  const { running } = deps.runtime;
  const log = deps.logger;
  const onProgress = deps.progress;
  const coreDeps = { paths, downloader, platform, logger: log };
  const loaderDeps = { ...coreDeps, loaders };

  /** The loader build a profile plays (pinned, installed, or the newest). */
  async function loaderVersionOf(
    profile: Profile,
  ): Promise<string | undefined> {
    const loader = profile.loader;
    if (!loader) return undefined;
    if (loader.version) return loader.version;
    if (profile.installedVersionId) {
      const marker = await readInstallMarker(paths, profile.installedVersionId);
      if (marker?.loader?.id === loader.id) return marker.loader.loaderVersion;
    }
    const installed = (await listInstalledVersions(paths)).find(
      (v) =>
        v.loader?.id === loader.id &&
        v.loader.gameVersion === profile.gameVersion,
    );
    if (installed?.loader) return installed.loader.loaderVersion;
    return loaders
      .get(loader.id)
      .getLatestLoaderVersion(profile.gameVersion)
      .catch(() => undefined);
  }

  function queueLoaderInstall(
    request: LoaderInstallRequest,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    return queue.enqueue(request.versionId, async (signal) => {
      await afterJava();
      return install.loader(loaderDeps, request, { mode, signal, onProgress });
    });
  }

  /** Install, check or repair an installed version; loader installs go through their loader. */
  async function ensureInstalled(
    versionId: string,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    const loader = (await readInstallMarker(paths, versionId))?.loader;
    if (loader) {
      return queueLoaderInstall(
        {
          providerId: loader.id,
          gameVersion: loader.gameVersion,
          loaderVersion: loader.loaderVersion,
          versionId,
        },
        mode,
      );
    }
    return queue.enqueue(versionId, async (signal) => {
      await afterJava();
      return install.version(coreDeps, versionId, { mode, signal, onProgress });
    });
  }

  /**
   * The installed version a profile plays, installing it first if needed.
   * An install the profile already has stays on its build; a loader profile reuses
   * an existing install of that loader for its Minecraft version (of its pinned
   * build, when it has one).
   */
  async function ensureProfileInstall(
    profile: Profile,
  ): Promise<{ versionId: string; installed: InstalledVersion }> {
    const current = profile.installedVersionId;
    if (current && (await isInstalled(paths, current))) {
      return {
        versionId: current,
        installed: await ensureInstalled(current, "quick"),
      };
    }
    const { gameVersion, loader } = profile;
    if (!loader) {
      const mode = (await isInstalled(paths, gameVersion))
        ? "quick"
        : "install";
      return {
        versionId: gameVersion,
        installed: await ensureInstalled(gameVersion, mode),
      };
    }
    const existing = (await listInstalledVersions(paths)).find(
      (v) =>
        v.loader?.id === loader.id &&
        v.loader.gameVersion === gameVersion &&
        (loader.version === undefined ||
          v.loader.loaderVersion === loader.version),
    );
    if (existing) {
      return {
        versionId: existing.id,
        installed: await ensureInstalled(existing.id, "quick"),
      };
    }
    const request = await install.prepareLoader(
      loaderDeps,
      loader.id,
      gameVersion,
      {
        ...(loader.version !== undefined && { loaderVersion: loader.version }),
      },
    );
    return {
      versionId: request.versionId,
      installed: await queueLoaderInstall(request, "install"),
    };
  }

  function assertVersionIdle(versionId: string): void {
    if (queue.isBusy(versionId)) {
      throw new AppError(
        "BUSY",
        "Wait for the install to finish or cancel it first.",
      );
    }
    if ([...running.values()].some((g) => g.versionId === versionId)) {
      throw new AppError("GAME_RUNNING", "Close the game first.");
    }
  }

  /** Also a running game on an install built on this version (e.g. Fabric on 1.18.2). */
  async function assertVersionNotPlayed(versionId: string): Promise<void> {
    assertVersionIdle(versionId);
    for (const g of running.values()) {
      const base = (await readInstallMarker(paths, g.versionId))?.loader
        ?.gameVersion;
      if (base === versionId)
        throw new AppError("GAME_RUNNING", "Close the game first.");
    }
  }

  /** Profiles that play each installed version, directly or through a loader install on it. */
  async function versionUsers(): Promise<Map<string, string[]>> {
    const installed = await listInstalledVersions(paths);
    const users = new Map<string, string[]>();
    const add = (versionId: string, profileId: string) => {
      users.set(versionId, [...(users.get(versionId) ?? []), profileId]);
    };
    for (const p of await profiles.list()) {
      const versionId = p.installedVersionId;
      if (!versionId) continue;
      add(versionId, p.id);
      const parent = installed.find((v) => v.id === versionId)?.loader
        ?.gameVersion;
      if (parent) add(parent, p.id);
    }
    return users;
  }

  const loaderBuildCache = new Map<string, Promise<LoaderBuildInfo[]>>();

  function validateLoader(loader: unknown): void {
    if (
      loader &&
      typeof loader === "object" &&
      "id" in loader &&
      typeof loader.id === "string"
    ) {
      loaders.get(loader.id); // throws LOADER_UNKNOWN
    }
  }

  const api = {
    listVersions(options: { refresh?: boolean }): Promise<VersionListResult> {
      return getVersionList(coreDeps, options);
    },

    async installedVersions(): Promise<InstalledVersionInfo[]> {
      await whenReady();
      const [installed, users] = await Promise.all([
        listInstalledVersions(paths),
        versionUsers(),
      ]);
      return Promise.all(
        installed.map(async (v) => ({
          ...v,
          usedBy: users.get(v.id) ?? [],
          dependents: await listDependents(paths, v.id),
        })),
      );
    },

    async installVersion(versionId: string): Promise<void> {
      await ensureInstalled(versionId, "install");
    },

    async repairVersion(versionId: string): Promise<void> {
      await assertVersionNotPlayed(versionId);
      await ensureInstalled(versionId, "repair");
    },

    listLoaders({ refresh }: { refresh?: boolean }): Promise<LoaderInfo[]> {
      return Promise.all(
        loaders.providers.map(async (p) => ({
          id: p.id,
          displayName: p.displayName,
          gameVersions: await getSupportedGameVersions(p, paths, {
            ...(refresh !== undefined && { refresh }),
            logger: log,
          }),
        })),
      );
    },

    /** A loader's builds for a Minecraft version (kept for the session). */
    async loaderBuilds({
      loaderId,
      gameVersion,
    }: {
      loaderId: string;
      gameVersion: string;
    }): Promise<LoaderBuildInfo[]> {
      const provider = loaders.get(loaderId);
      const key = `${provider.id}:${safeId(gameVersion)}`;
      let builds = loaderBuildCache.get(key);
      if (!builds) {
        builds = provider.listLoaderVersions(gameVersion);
        loaderBuildCache.set(key, builds);
        builds.catch(() => loaderBuildCache.delete(key));
      }
      return builds;
    },

    cancelInstall(versionId: string): boolean {
      return queue.cancel(versionId);
    },

    /** A version's changelog from Mojang's patch notes (saved after the first look). */
    async versionPatchNotes(versionId: string): Promise<PatchNotes | null> {
      if (typeof versionId !== "string" || versionId.length > 128)
        throw new AppError("VERSION_UNKNOWN", "Unknown version.");
      return patchNotes.get(versionId);
    },

    /**
     * Delete a version and the installs built on it. Profiles that use them keep
     * working: they reinstall on their next Play.
     */
    async deleteVersion(versionId: string, force: boolean): Promise<void> {
      await whenReady();
      const dependents = await listDependents(paths, versionId);
      const usedBy = (await versionUsers()).get(versionId) ?? [];
      if ((dependents.length > 0 || usedBy.length > 0) && !force) {
        throw new AppError(
          "VERSION_IN_USE",
          `${versionId} is used by profiles or other installs.`,
        );
      }
      for (const id of [...dependents, versionId]) assertVersionIdle(id);
      // Dependents first, so a failure never leaves one without its base version.
      for (const id of dependents) await deleteVersion(paths, id);
      await deleteVersion(paths, versionId);
      changed();
    },
  };

  return {
    api,
    ensureProfileInstall,
    loaderVersionOf,
    validateLoader,
  };
}

export type VersionService = ReturnType<typeof createVersionService>;
