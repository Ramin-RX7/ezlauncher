import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { app, BrowserWindow, net, shell } from "electron";
import type {
  AccountInfo,
  AddModsResult,
  DeleteWorldsChoice,
  DisablePlan,
  InstalledVersionInfo,
  InstallProgress,
  LaunchRequest,
  LaunchResult,
  LibraryMod,
  LoaderInfo,
  OrphanWorld,
  Profile,
  ProfileInfo,
  RemoteMatchCard,
  RunningGame,
  ValidationReport,
  VersionListResult,
  WorldInfo,
} from "@shared/launcher";
import { createAccountStore } from "../auth/accountStore";
import { OFFLINE_PROVIDER_ID } from "../auth/providers/offline";
import { getProvider } from "../auth/registry";
import type { Account } from "../auth/types";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { broadcast } from "../ipc/register";
import { buildLaunchCommand } from "../minecraft/arguments";
import { applyLegacyAssets } from "../minecraft/assets";
import { createDownloader } from "../minecraft/downloader";
import { launchGame } from "../minecraft/gameProcess";
import {
  deleteVersion,
  installVersion,
  isInstalled,
  listDependents,
  readInstallMarker,
  type InstalledVersion,
  type InstallMode,
} from "../minecraft/installer";
import { InstallQueue } from "../minecraft/installQueue";
import {
  installLoader,
  prepareLoader,
  type LoaderInstallRequest,
} from "../minecraft/loaders/installLoader";
import {
  createLoaderRegistry,
  getSupportedGameVersions,
} from "../minecraft/loaders/registry";
import {
  getManifest,
  getVersionList,
  listInstalledVersions,
} from "../minecraft/manifest";
import { createPaths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { downloadPlan } from "../modsources/downloadMods";
import { createModSourceRegistry } from "../modsources/registry";
import {
  resolveInstall,
  type InstallPlan,
} from "../modsources/resolveDependencies";
import { acceptedLoaders, checkCompat } from "../profiles/compat";
import { removeTree } from "../profiles/links";
import { createModLibrary, type ModSourceRef } from "../profiles/mods";
import { migrateLegacyGames } from "../profiles/migrate";
import { createProfileStore } from "../profiles/profiles";
import {
  deleteWorld,
  listOrphans,
  listWorlds,
  moveWorld,
  readWorldOwner,
  rescueUnlinkedWorlds,
  syncWorlds,
  worldsOwnedBy,
} from "../profiles/worlds";
import { createSettingsStore } from "../settings/settings";
import { collectInput } from "../validation/collect";
import { checkIntegrity } from "../validation/integrity";
import type { ValidationInput } from "../validation/types";
import {
  disableCascade,
  orphanedDependencies,
  validate,
} from "../validation/validate";

/**
 * The composition root for one data folder: wires the Electron-free core
 * (downloads, installs, profiles, worlds, launches) to Electron (network, windows, IPC events).
 */
export function createLauncherService(dataDir: string, logger: Logger) {
  const log = logger.child("launcher");
  const paths = createPaths(dataDir);
  const platform = detectPlatform();
  const downloader = createDownloader({
    // Electron's fetch uses the system proxy settings.
    fetch: (url, init) => net.fetch(url, init),
    userAgent: `ezlauncher/${app.getVersion()}`,
    logger: logger.child("download"),
  });
  const deps = { paths, downloader, platform, logger: log };
  const loaders = createLoaderRegistry({ downloader });
  const loaderDeps = { ...deps, loaders };
  const settings = createSettingsStore(paths.launcherFile("settings.json"));
  const accounts = createAccountStore(paths.launcherFile("accounts.json"));
  const profiles = createProfileStore(paths.launcherFile("profiles.json"));
  const mods = createModLibrary({ paths, logger: log });
  const sources = createModSourceRegistry({
    fetch: (url, init) => net.fetch(url, init),
    // Modrinth asks every app to say who it is.
    userAgent: `ezlauncher/${app.getVersion()} (github.com/Ramin-RX7/ezlauncher)`,
    logger: logger.child("modsources"),
  });
  /** Confirmed-card plans waiting for Download, by plan id. */
  const plans = new Map<
    string,
    {
      plan: InstallPlan;
      profileId: string;
      createdAt: number;
      controller?: AbortController;
    }
  >();
  const PLAN_TTL_MS = 15 * 60 * 1000;
  const EMPTY_INPUT: ValidationInput = {
    gameVersion: "",
    loader: null,
    mods: [],
  };
  const queue = new InstallQueue((event) => {
    broadcast("install:state", event);
  });
  const running = new Map<string, RunningGame>();

  const onProgress = (p: InstallProgress): void => {
    broadcast("install:progress", p);
  };
  const changed = (): void => {
    broadcast("profiles:changed", {});
  };

  // ---- Folder work (worlds, profile folders) runs one operation at a time. ----

  let fsQueue: Promise<unknown> = Promise.resolve();
  function serialFs<T>(fn: () => Promise<T>): Promise<T> {
    const run = fsQueue.then(fn, fn);
    fsQueue = run.catch(() => undefined);
    return run;
  }

  const isRunning = (profileId: string): boolean =>
    [...running.values()].some((g) => g.profileId === profileId);

  async function worldOptions() {
    return {
      profileIds: (await profiles.list()).map((p) => p.id),
      isRunning,
    };
  }

  /** World and mod sync for some (default: all) profiles; running ones are skipped. */
  function sync(only?: string[]): Promise<void> {
    return serialFs(async () => {
      const options = { ...(await worldOptions()), ...(only && { only }) };
      const result = await syncWorlds({ paths, logger: log }, options);
      for (const u of result.unlinked)
        log.warn(`world ${u.worldId} of ${u.profileId} isn't linked`);
      if ((await mods.sync(options)) > 0) scheduleIdentify();
    });
  }

  // ---- Identifying mods by hash (Modrinth badge for hand-added jars) ----

  let identifyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ask the mod sources about new jars soon; several adds in a row make one request. */
  function scheduleIdentify(delayMs = 2000): void {
    if (identifyTimer) clearTimeout(identifyTimer);
    identifyTimer = setTimeout(() => {
      identifyTimer = undefined;
      void identifyPending().catch((err: unknown) => {
        log.info('identifying mods failed; they stay "not checked yet"', err);
      });
    }, delayMs);
    identifyTimer.unref();
  }

  async function identifyPending(): Promise<void> {
    const pending = await mods.pendingIdentification();
    if (pending.length === 0) return;
    const matches = new Map<string, ModSourceRef>();
    for (const source of sources.sources) {
      const left = pending.filter((sha1) => !matches.has(sha1));
      if (left.length === 0) break;
      // Offline: throws, and nothing is recorded, so they're asked again next start.
      for (const [sha1, v] of await source.identifyFiles(left)) {
        matches.set(sha1, {
          sourceId: v.sourceId,
          projectId: v.projectId,
          versionId: v.versionId,
          pageUrl: source.pageUrl(v.projectId),
          loaders: v.loaders,
          gameVersions: v.gameVersions,
        });
      }
    }
    const found = await mods.recordIdentification(pending, matches);
    log.info(`identified ${found} of ${pending.length} mods`);
    changed();
  }

  // ---- Mod validation (Scope 05) ----

  const collectDeps = {
    paths,
    library: mods,
    versions: async () => (await getManifest(deps)).cached?.manifest.versions,
  };
  /** The last report per profile, and what it was computed from. */
  const reports = new Map<string, { key: string; report: ValidationReport }>();

  /**
   * Check a profile's enabled mods (the caller syncs first). The quick damage check
   * runs every time; the SHA1 only for files that changed, or for all with `full`.
   */
  async function checkProfileMods(
    profile: Profile,
    { full = false }: { full?: boolean } = {},
  ): Promise<{ input: ValidationInput; report: ValidationReport }> {
    const { input, files } = await collectInput(collectDeps, profile);
    const integrity = await checkIntegrity(files, { full });
    await mods.recordVerified(integrity.verified);
    const checked = { ...input, damaged: integrity.damaged };
    const key = JSON.stringify([
      input.mods.map((m) => m.sha1).sort(),
      input.gameVersion,
      input.mcVersion,
      input.loader,
      input.javaMajor,
      [...integrity.damaged],
    ]);
    const cached = reports.get(profile.id);
    if (cached?.key === key) return { input: checked, report: cached.report };
    const report = validate(checked);
    reports.set(profile.id, { key, report });
    return { input: checked, report };
  }

  // Old per-version game folders become profiles, then every profile's worlds are synced.
  const ready: Promise<void> = (async () => {
    try {
      const created = await serialFs(() =>
        migrateLegacyGames({ paths, profiles, logger: log }),
      );
      if (created.length > 0)
        log.info(`created ${created.length} profiles from old game folders`);
      await sync();
    } catch (err) {
      log.error("startup profile/world sync failed", err);
    }
    changed();
    scheduleIdentify(0); // mods added while offline
  })();

  async function requireProfile(id: string): Promise<Profile> {
    await ready;
    const profile = await profiles.get(id);
    if (!profile) throw new AppError("PROFILE_NOT_FOUND", "Profile not found.");
    return profile;
  }

  function assertNotRunning(profileId: string): void {
    if (isRunning(profileId))
      throw new AppError("GAME_RUNNING", "Close the game first.");
  }

  // ---- Installs ----

  function queueLoaderInstall(
    request: LoaderInstallRequest,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    return queue.enqueue(request.versionId, (signal) =>
      installLoader(loaderDeps, request, { mode, signal, onProgress }),
    );
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
    return queue.enqueue(versionId, (signal) =>
      installVersion(deps, versionId, { mode, signal, onProgress }),
    );
  }

  /**
   * The installed version a profile plays, installing it first if needed.
   * An install the profile already has stays on its build; a loader profile reuses
   * an existing install of that loader for its Minecraft version.
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
      (v) => v.loader?.id === loader.id && v.loader.gameVersion === gameVersion,
    );
    if (existing) {
      return {
        versionId: existing.id,
        installed: await ensureInstalled(existing.id, "quick"),
      };
    }
    const request = await prepareLoader(loaderDeps, loader.id, gameVersion);
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

  // ---- Accounts ----

  function toInfo(a: Account): AccountInfo {
    return { id: a.id, username: a.username, uuid: a.uuid };
  }

  // ---- Misc ----

  async function openFolder(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new AppError("OPEN_FAILED", error);
  }

  function applyOnGameStart(mode: "keep" | "minimize" | "close"): void {
    if (mode === "minimize") {
      for (const w of BrowserWindow.getAllWindows()) w.minimize();
    }
    if (mode === "close") app.quit(); // the game keeps running on its own
  }

  return {
    paths,

    // ---- Versions ----

    listVersions(options: { refresh?: boolean }): Promise<VersionListResult> {
      return getVersionList(deps, options);
    },

    async installedVersions(): Promise<InstalledVersionInfo[]> {
      await ready;
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

    cancelInstall(versionId: string): boolean {
      return queue.cancel(versionId);
    },

    /**
     * Delete a version and the installs built on it. Profiles that use them keep
     * working: they reinstall on their next Play.
     */
    async deleteVersion(versionId: string, force: boolean): Promise<void> {
      await ready;
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

    // ---- Profiles ----

    async listProfiles(): Promise<ProfileInfo[]> {
      await ready;
      return (await profiles.list()).map((p) => ({
        ...p,
        running: [...running.values()].filter((g) => g.profileId === p.id)
          .length,
      }));
    },

    async createProfile(input: unknown): Promise<Profile> {
      await ready;
      validateLoader((input as { loader?: unknown } | null)?.loader);
      const profile = await profiles.create(input);
      await mkdir(paths.gameDir(profile.id), { recursive: true });
      changed();
      return profile;
    },

    async updateProfile(id: string, patch: unknown): Promise<Profile> {
      await requireProfile(id);
      validateLoader((patch as { loader?: unknown } | null)?.loader);
      const profile = await profiles.update(id, patch);
      changed();
      return profile;
    },

    /** Delete a profile. Its worlds are deleted or moved to another profile, as chosen. */
    async deleteProfile(id: string, worlds: DeleteWorldsChoice): Promise<void> {
      await requireProfile(id);
      assertNotRunning(id);
      const moveTo = typeof worlds === "object" ? worlds.moveTo : undefined;
      if (moveTo !== undefined) {
        if (moveTo === id)
          throw new AppError("INVALID_PROFILE", "Pick another profile.");
        await requireProfile(moveTo);
        assertNotRunning(moveTo);
      } else if (worlds !== "delete") {
        throw new AppError(
          "INVALID_PROFILE",
          "Choose what to do with the worlds.",
        );
      }

      await serialFs(async () => {
        if (moveTo) {
          // First the worlds still sitting in saves/ (made in game, not synced yet),
          // so they go to the new owner too.
          await rescueUnlinkedWorlds(paths, id, moveTo);
          const options = await worldOptions();
          for (const worldId of await worldsOwnedBy(paths, id))
            await moveWorld({ paths, logger: log }, worldId, moveTo, options);
        } else {
          const owned = await worldsOwnedBy(paths, id);
          for (const worldId of owned) await deleteWorld(paths, worldId);
        }
        await profiles.remove(id);
        // Never follows links, so worlds linked into this profile can't be touched.
        // Its mods are hard links: the library keeps them.
        await removeTree(paths.gameDir(id));
        await mods.forgetProfile(id);
      });
      if (moveTo) await sync([moveTo]);
      const current = await settings.load();
      if (current.selectedProfileId === id)
        await settings.update({ selectedProfileId: null });
      changed();
    },

    async openProfileFolder(
      id: string,
      folder: "game" | "mods" = "game",
    ): Promise<void> {
      await requireProfile(id);
      await openFolder(
        folder === "mods" ? paths.modsDir(id) : paths.gameDir(id),
      );
    },

    // ---- Worlds ----

    async listWorlds(profileId: string): Promise<WorldInfo[]> {
      await requireProfile(profileId);
      return serialFs(() => listWorlds(paths, profileId));
    },

    async moveWorld(worldId: string, toProfileId: string): Promise<void> {
      await requireProfile(toProfileId);
      await serialFs(async () => {
        const from = await readWorldOwner(paths, worldId);
        for (const p of [from, toProfileId]) if (p) assertNotRunning(p);
        await moveWorld(
          { paths, logger: log },
          worldId,
          toProfileId,
          await worldOptions(),
        );
      });
      changed();
    },

    async listOrphanWorlds(): Promise<OrphanWorld[]> {
      await ready;
      const { profileIds } = await worldOptions();
      return serialFs(() => listOrphans(paths, profileIds));
    },

    async openWorldFolder(profileId: string, worldId: string): Promise<void> {
      await requireProfile(profileId);
      const linked = (await listWorlds(paths, profileId)).find(
        (w) => w.id === worldId,
      );
      if (!linked) throw new AppError("WORLD_NOT_FOUND", "World not found.");
      await openFolder(
        linked.linked
          ? paths.worldDir(worldId)
          : paths.saveLink(profileId, worldId),
      );
    },

    // ---- Mods ----

    /** The library (synced first); from a profile's view with its state and compatibility. */
    async modLibrary(profileId?: string): Promise<LibraryMod[]> {
      if (profileId === undefined) {
        await ready;
        await sync();
        return mods.list();
      }
      const profile = await requireProfile(profileId);
      await sync([profileId]);
      return mods.list(profile);
    },

    modIcon: (sha1: string) => mods.icon(sha1),

    /**
     * Add jar files to the library; with a profile, also enable the ones that fit it.
     * Paths come from a file picker or drag and drop: only existing `.jar` files are taken.
     */
    async addMods(
      files: readonly string[],
      profileId?: string,
    ): Promise<AddModsResult> {
      await ready;
      const profile = profileId ? await requireProfile(profileId) : undefined;
      const result: AddModsResult = { added: 0, existing: 0, failed: [] };
      const valid: string[] = [];
      for (const path of files) {
        const fileName = typeof path === "string" ? basename(path) : "?";
        try {
          if (
            typeof path !== "string" ||
            !isAbsolute(path) ||
            !/\.jar$/i.test(path)
          )
            throw new AppError("NOT_A_JAR", "Not a jar file.");
          const info = await stat(path);
          if (!info.isFile() || info.size > 512 * 1024 * 1024)
            throw new AppError("NOT_A_JAR", "Not a jar file.");
          valid.push(path);
        } catch (err) {
          result.failed.push({
            fileName,
            code: err instanceof AppError ? err.code : "NOT_A_JAR",
          });
        }
      }

      const added = await serialFs(() => mods.add(valid));
      for (const item of added) {
        if (item.added) result.added++;
        else result.existing++;
        if (!profile) continue;
        const meta = await mods.meta(item.sha1);
        if (!meta || checkCompat(meta, profile).status === "incompatible") {
          result.failed.push({
            fileName: item.fileName,
            code: "MOD_INCOMPATIBLE",
          });
        } else if (isRunning(profile.id)) {
          result.failed.push({ fileName: item.fileName, code: "GAME_RUNNING" });
        } else {
          await serialFs(() => mods.enable(profile.id, item.sha1));
        }
      }
      if (result.added > 0) scheduleIdentify();
      changed();
      return result;
    },

    /**
     * Exact-name search on the mod sites for this profile's loader and version.
     * Each match comes with what Download would do (dependencies, size, warnings).
     */
    async findRemoteMods(
      profileId: string,
      query: string,
    ): Promise<RemoteMatchCard[]> {
      const profile = await requireProfile(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      const text = typeof query === "string" ? query.trim() : "";
      if (!text || text.length > 100) return [];
      const target = {
        gameVersion: profile.gameVersion,
        loaders: acceptedLoaders(profile.loader.id),
      };
      for (const [id, entry] of plans)
        if (Date.now() - entry.createdAt > PLAN_TTL_MS && !entry.controller)
          plans.delete(id);

      // Hand-added jars count once a site knows them (for "replaces" and reuse): ask now.
      await identifyPending().catch((err: unknown) => {
        log.info("identifying mods before the search failed", err);
      });

      const cards: RemoteMatchCard[] = [];
      for (const source of sources.sources) {
        for (const project of await source.findExact(text, target)) {
          const card: RemoteMatchCard = {
            sourceId: source.id,
            project: {
              projectId: project.projectId,
              name: project.name,
              author: project.author,
              ...(project.iconUrl && { iconUrl: project.iconUrl }),
              pageUrl: project.pageUrl,
              ...(project.downloads !== undefined && {
                downloads: project.downloads,
              }),
            },
            version: null,
            dependencies: [],
            missing: [],
            incompatible: [],
            replaces: [],
            totalSize: 0,
          };
          cards.push(card);
          const version = await source.getCompatibleVersion(
            project.projectId,
            target,
          );
          if (!version) continue;

          const view = await mods.view(profile);
          const plan = await resolveInstall(source, version, target, view);
          const ids = new Set<string>();
          for (const item of plan.items)
            if (item.action === "download" && !item.root)
              ids.add(item.version.projectId);
          for (const m of plan.missing) if (m.projectId) ids.add(m.projectId);
          const names = new Map(
            (await source.getProjects([...ids]).catch(() => [])).map((p) => [
              p.projectId,
              p.name,
            ]),
          );

          card.version = {
            versionNumber: version.versionNumber,
            fileName: version.file.fileName,
          };
          card.dependencies = plan.items.flatMap(
            (item): RemoteMatchCard["dependencies"] => {
              if (item.action === "reuse")
                return [{ name: item.name, action: "reuse" as const }];
              if (item.root) return [];
              return [
                {
                  name:
                    names.get(item.version.projectId) ??
                    item.version.file.fileName,
                  versionNumber: item.version.versionNumber,
                  action: "download" as const,
                },
              ];
            },
          );
          card.missing = plan.missing.map(
            (m) =>
              (m.projectId && names.get(m.projectId)) ??
              m.projectId ??
              m.versionId ??
              "?",
          );
          card.incompatible = plan.incompatible.flatMap((projectId) =>
            view.enabledFromProject(source.id, projectId).map((m) => m.name),
          );
          card.replaces = plan.replaces.map((m) => m.name);
          card.totalSize = plan.totalSize;
          if (plan.missing.length === 0) {
            const planId = randomUUID();
            plans.set(planId, { plan, profileId, createdAt: Date.now() });
            card.planId = planId;
          }
        }
      }
      return cards;
    },

    /** Download a confirmed card: the mod and its dependencies, enabled in the profile. */
    async installRemoteMod(planId: string): Promise<{ replaced: string[] }> {
      const entry = plans.get(planId);
      if (!entry || entry.controller)
        throw new AppError(
          "PLAN_EXPIRED",
          "Search again, then press Download.",
        );
      await requireProfile(entry.profileId);
      assertNotRunning(entry.profileId);
      const controller = new AbortController();
      entry.controller = controller;
      try {
        return await serialFs(() =>
          downloadPlan(
            {
              downloader,
              paths,
              library: mods,
              source: sources.get(entry.plan.sourceId),
            },
            entry.plan,
            entry.profileId,
            {
              signal: controller.signal,
              onProgress: (p) => {
                broadcast("mods:download", { planId, ...p });
              },
            },
          ),
        );
      } finally {
        plans.delete(planId);
        changed();
      }
    },

    cancelRemoteMod(planId: string): boolean {
      const controller = plans.get(planId)?.controller;
      controller?.abort();
      return controller !== undefined;
    },

    /**
     * Tick or untick a library mod in a profile. Incompatible mods can't be enabled.
     * A mod that another enabled mod needs can't be unticked (`MOD_REQUIRED`); unticking
     * one also disables the dependencies nothing else needs any more.
     */
    async setModEnabled(
      profileId: string,
      sha1: string,
      enabled: boolean,
    ): Promise<{ disabled: string[] }> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (enabled) {
        const meta = await mods.meta(sha1);
        if (!meta)
          throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
        if (checkCompat(meta, profile).status === "incompatible")
          throw new AppError(
            "MOD_INCOMPATIBLE",
            "This mod doesn't fit the profile.",
          );
        await serialFs(() => mods.enable(profileId, sha1));
        return { disabled: [] };
      }
      const { input } = await collectInput(collectDeps, profile);
      const needs = validate(input).requiredBy[sha1] ?? [];
      if (needs.length > 0) {
        const names = input.mods
          .filter((m) => needs.includes(m.sha1))
          .map((m) => m.name);
        throw new AppError("MOD_REQUIRED", `Needed by ${names.join(", ")}.`);
      }
      const orphans = orphanedDependencies(input, sha1);
      await serialFs(async () => {
        for (const id of [sha1, ...orphans]) await mods.disable(profileId, id);
      });
      return { disabled: orphans };
    },

    /** The Mods tab's check: problems of the enabled mods, and which mod needs which. */
    async validateMods(
      profileId: string,
      { full = false }: { full?: boolean } = {},
    ): Promise<ValidationReport> {
      const profile = await requireProfile(profileId);
      if (!profile.loader) return validate(EMPTY_INPUT);
      await sync([profileId]);
      return (await checkProfileMods(profile, { full })).report;
    },

    /** What "Disable problem mods and play" would disable, shown before confirming. */
    async disablePlan(profileId: string): Promise<DisablePlan> {
      const profile = await requireProfile(profileId);
      if (!profile.loader) return { mods: [] };
      await sync([profileId]);
      return disableCascade((await checkProfileMods(profile)).input);
    },

    /** Download a damaged mod again from where it came from, and link it again everywhere. */
    async redownloadMod(sha1: string): Promise<void> {
      await ready;
      const meta = await mods.meta(sha1);
      if (!meta)
        throw new AppError("MOD_NOT_FOUND", "This mod isn't in the library.");
      if (!meta.source)
        throw new AppError("MOD_NO_SOURCE", "No site is known for this mod.");
      for (const id of await mods.usedBy(sha1)) assertNotRunning(id);
      const source = sources.get(meta.source.sourceId);
      const version = await source.getVersion(
        meta.source.versionId,
        undefined,
        sha1,
      );
      if (version.file.sha1 !== sha1)
        throw new AppError(
          "MOD_NO_SOURCE",
          `${source.displayName} no longer has this file.`,
        );
      const tmp = `${paths.modStoreFile(sha1)}.redownload`;
      await serialFs(async () => {
        try {
          await rm(tmp, { force: true });
          await downloader.run([
            { dest: tmp, url: version.file.url, sha1, size: version.file.size },
          ]);
          await mods.replaceStored(sha1, tmp);
        } finally {
          await rm(tmp, { force: true });
        }
      });
      reports.clear();
      changed();
    },

    /** Delete a mod from the library. Asks first (`MOD_IN_USE`) when profiles use it. */
    async removeMod(sha1: string, force: boolean): Promise<void> {
      await ready;
      const users = await mods.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError("MOD_IN_USE", "Profiles use this mod.");
      for (const id of users) assertNotRunning(id);
      await serialFs(() => mods.remove(sha1));
      changed();
    },

    async removeUnusedMods(): Promise<number> {
      await ready;
      await sync();
      const count = await serialFs(() => mods.removeUnused());
      changed();
      return count;
    },

    // ---- Accounts ----

    async listAccounts(): Promise<AccountInfo[]> {
      return (await accounts.load()).accounts.map(toInfo);
    },

    /** Scope 03 has one offline account: create it, or rename it (keeping its UUID). */
    async setUsername(username: string): Promise<AccountInfo> {
      const data = await accounts.load();
      const provider = getProvider(OFFLINE_PROVIDER_ID);
      const current =
        data.accounts.find((a) => a.id === data.selectedId) ?? data.accounts[0];
      let account: Account;
      if (current && provider.renameAccount) {
        account = await provider.renameAccount(current, username);
        data.accounts = data.accounts.map((a) =>
          a.id === account.id ? account : a,
        );
      } else {
        account = await provider.createAccount({ username });
        data.accounts.push(account);
      }
      data.selectedId = account.id;
      await accounts.save(data);
      return toInfo(account);
    },

    // ---- Settings ----

    getSettings: () => settings.load(),
    updateSettings: (patch: unknown) => settings.update(patch),

    // ---- Games ----

    runningGames: (): RunningGame[] => [...running.values()],

    /** Install or check the profile's version, sync its worlds, and start it as the account. */
    async launch({
      profileId,
      accountId,
      problems = "check",
    }: LaunchRequest): Promise<LaunchResult> {
      let profile = await requireProfile(profileId);
      const account = (await accounts.load()).accounts.find(
        (a) => a.id === accountId,
      );
      if (!account)
        throw new AppError("NO_ACCOUNT", "Choose an account first.");
      const identity = await getProvider(account.providerId).getLaunchIdentity(
        account,
      );
      const current = await settings.load();

      const { versionId, installed } = await ensureProfileInstall(profile);
      if (profile.installedVersionId !== versionId)
        await profiles.setInstalled(profile.id, versionId);

      // A profile that is already running keeps its folders as they are.
      if (!isRunning(profile.id)) await sync([profile.id]);

      // Check the mods. With errors the user decides: see them, disable those mods, or play anyway.
      let warnings = 0;
      if (profile.loader) {
        profile = await requireProfile(profile.id); // with its install recorded
        const id = profile.id;
        if (typeof problems === "object" && !isRunning(id)) {
          const off = Array.isArray(problems.disable)
            ? problems.disable.filter((s): s is string => typeof s === "string")
            : [];
          await serialFs(async () => {
            for (const sha1 of off) await mods.disable(id, sha1);
          });
        }
        const { report } = await checkProfileMods(profile);
        if (report.errorCount > 0 && problems === "check")
          return { status: "blocked", report };
        warnings = report.warningCount;
      }

      const gameDir = paths.gameDir(profile.id);
      await applyLegacyAssets(
        installed.assetIndex,
        installed.assetIndexId,
        paths,
        gameDir,
      );
      const command = buildLaunchCommand({
        installed,
        identity,
        paths,
        platform,
        gameDir,
        memoryMaxMb: profile.memoryMaxMb ?? current.memoryMaxMb,
        ...(profile.extraJvmArgs && { extraJvmArgs: profile.extraJvmArgs }),
        launcherName: "ezlauncher",
        launcherVersion: app.getVersion(),
        logger: log,
      });
      log.info(
        `launching profile ${profile.id} (${versionId}) as ${identity.username}`,
      );
      log.debug([command.javaPath, ...command.args].join(" "));

      const handle = await launchGame(command, {
        logFile: join(gameDir, "logs", "ezlauncher-output.log"),
      });
      const game: RunningGame = {
        launchId: randomUUID(),
        profileId: profile.id,
        accountId: account.id,
        versionId,
        pid: handle.pid,
      };
      running.set(game.launchId, game);
      handle.onLog((lines) => {
        broadcast("game:log", {
          launchId: game.launchId,
          profileId: profile.id,
          lines,
        });
      });
      handle.onExit(({ code, crashed }) => {
        running.delete(game.launchId);
        log.info(
          `${versionId} exited with code ${String(code)}${crashed ? " (crashed)" : ""}`,
        );
        broadcast("game:exit", {
          launchId: game.launchId,
          profileId: profile.id,
          versionId,
          code,
          crashed,
        });
        // The last game of this profile closed: pick up worlds created or deleted in game.
        if (!isRunning(profile.id)) {
          void sync([profile.id])
            .catch((err: unknown) => {
              log.error("world sync after exit failed", err);
            })
            .finally(changed);
        }
      });
      broadcast("game:started", game);
      await profiles.touchLastPlayed(profile.id);
      changed();

      applyOnGameStart(current.onGameStart);
      return { status: "started", game, warnings };
    },
  };
}

export type LauncherService = ReturnType<typeof createLauncherService>;
