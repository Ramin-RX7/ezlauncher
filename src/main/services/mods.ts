import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type {
  AddModsResult,
  ApplyModsResult,
  BulkDownloadResult,
  DisablePlan,
  LibraryMod,
  ModUpdateCheck,
  ModUpdateResult,
  Profile,
  RemoteMatchCard,
  ValidationReport,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { Downloader } from "../minecraft/downloader";
import type { Paths } from "../minecraft/paths";
import type { VersionManifest } from "../minecraft/schemas";
import { readManifest } from "../modpacks/manifest";
import { resolveBulk, type BulkResult } from "../modsources/bulkFetch";
import { downloadPlan, storeVersions } from "../modsources/downloadMods";
import { applyModUpdates, findModUpdates } from "../modsources/modUpdates";
import type { ModSourceRegistry } from "../modsources/registry";
import {
  resolveInstall,
  type InstallPlan,
} from "../modsources/resolveDependencies";
import {
  describePlan,
  projectCard,
  projectsToName,
} from "../modsources/remoteCard";
import type { ModTarget, RemoteVersion } from "../modsources/types";
import { acceptedLoaders, checkCompat } from "../profiles/compat";
import type { ModLibrary, ModSourceRef } from "../profiles/mods";
import { collectInput } from "../validation/collect";
import { checkIntegrity } from "../validation/integrity";
import type { ValidationInput } from "../validation/types";
import {
  disableCascade,
  orphanedDependencies,
  validate,
} from "../validation/validate";
import type { EventPayload } from "@shared/ipc";
import type { Runtime } from "./runtime";

type DownloadEvent = EventPayload<"mods:download">;
type BulkEvent = EventPayload<"mods:bulkProgress">;

export interface ModServiceDeps {
  paths: Paths;
  downloader: Downloader;
  sources: ModSourceRegistry;
  mods: ModLibrary;
  runtime: Runtime;
  /** Resolves once startup (migration, first sync) is done. */
  whenReady: () => Promise<void>;
  requireProfile: (id: string) => Promise<Profile>;
  /** World, mod and pack sync for some (default: all) profiles. */
  sync: (only?: string[]) => Promise<void>;
  changed: () => void;
  /** Mojang's versions from the cached manifest (for Minecraft version ranges). */
  manifestVersions: () => Promise<VersionManifest["versions"] | undefined>;
  /** Ask the sites about packs added by hand too; resolves to whether any were asked. */
  identifyPacks: () => Promise<boolean>;
  downloadProgress: (p: DownloadEvent) => void;
  bulkProgress: (p: BulkEvent) => void;
  logger: Logger;
}

/** The mod library, Modrinth downloads, bulk re-fetches, updates and mod checks. */
export function createModService(deps: ModServiceDeps) {
  const {
    paths,
    downloader,
    sources,
    mods,
    runtime,
    whenReady,
    requireProfile,
    sync,
    changed,
  } = deps;
  const { serialFs, isRunning, assertNotRunning } = runtime;
  const log = deps.logger;

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
  const UPDATE_CHECK_TTL_MS = 10 * 60 * 1000;
  /** The bulk download in progress (library-wide or per-profile re-apply). */
  let bulk: AbortController | undefined;
  /** The last mod update check per profile, so Update uses exactly what was shown. */
  const updateChecks = new Map<
    string,
    { at: number; versions: Map<string, RemoteVersion> }
  >();
  const EMPTY_INPUT: ValidationInput = {
    gameVersion: "",
    loader: null,
    mods: [],
  };

  // ---- Identifying mods by hash (Modrinth badge for hand-added jars) ----

  let identifyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ask the mod sources about new jars soon; several adds in a row make one request. */
  function scheduleIdentify(delayMs = 2000): void {
    if (identifyTimer) clearTimeout(identifyTimer);
    if (runtime.moving) return;
    identifyTimer = setTimeout(() => {
      identifyTimer = undefined;
      void identifyPending().catch((err: unknown) => {
        log.info('identifying mods failed; they stay "not checked yet"', err);
      });
    }, delayMs);
    identifyTimer.unref();
  }

  /**
   * How a new version of a sourced mod enters the library: as a dependency when every
   * library copy of that project is only a dependency, otherwise as the user's own.
   */
  async function addedAsByProject(): Promise<
    (v: { sourceId: string; projectId: string }) => "user" | "dependency"
  > {
    const user = new Set<string>();
    const dep = new Set<string>();
    for (const m of await mods.list()) {
      if (!m.source) continue;
      const key = `${m.source.sourceId}:${m.source.projectId}`;
      (m.dependency ? dep : user).add(key);
    }
    return (v) => {
      const key = `${v.sourceId}:${v.projectId}`;
      return dep.has(key) && !user.has(key) ? "dependency" : "user";
    };
  }

  /**
   * The bulk download: each site's compatible version of its projects for a target,
   * stored in the library (one at a time, under the `bulk` lock; cancel aborts it).
   * `afterSite` runs once each site's files are stored. Resolves to how many were.
   */
  async function fetchForTarget(
    target: ModTarget,
    sites: { sourceId: string; projectIds: string[] }[],
    afterSite: (sourceId: string, res: BulkResult) => Promise<void>,
  ): Promise<number> {
    const addedAs = await addedAsByProject();
    const controller = new AbortController();
    bulk = controller;
    try {
      let downloaded = 0;
      for (const { sourceId, projectIds } of sites) {
        const source = sources.get(sourceId);
        const res = await resolveBulk(
          source,
          projectIds,
          target,
          controller.signal,
        );
        if (res.found.length > 0) {
          await serialFs(() =>
            storeVersions(
              { downloader, paths, library: mods, source },
              res.found.map((f) => f.version),
              {
                signal: controller.signal,
                onProgress: (p) => {
                  deps.bulkProgress(p);
                },
                addedAs,
              },
            ),
          );
          downloaded += res.found.length;
        }
        await afterSite(sourceId, res);
      }
      return downloaded;
    } finally {
      bulk = undefined;
      changed();
    }
  }

  /** Ask the mod sources about hand-added mods, resource packs and shaders. */
  async function identifyPending(): Promise<void> {
    const modsAsked = await identifyPendingMods();
    const packsAsked = await deps.identifyPacks();
    if (modsAsked || packsAsked) changed();
  }

  async function identifyPendingMods(): Promise<boolean> {
    const pending = await mods.pendingIdentification();
    if (pending.length === 0) return false;
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
    return true;
  }

  // ---- Mod validation (Scope 05) ----

  const collectDeps = {
    paths,
    library: mods,
    versions: deps.manifestVersions,
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

  /** Whether a profile has a mod turned on (by its id, what it provides, or one inside it). */
  async function hasMod(profileId: string, modId: string): Promise<boolean> {
    const matches = (m: { modId?: string; provides?: string[] }) =>
      m.modId === modId || (m.provides?.includes(modId) ?? false);
    return (await mods.enabledMods(profileId)).some(
      ({ meta }) => matches(meta) || (meta.nested?.some(matches) ?? false),
    );
  }

  const api = {
    /** The library (synced first); from a profile's view with its state and compatibility. */
    async modLibrary(profileId?: string): Promise<LibraryMod[]> {
      if (profileId === undefined) {
        await whenReady();
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
      await whenReady();
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
          const card = projectCard(source.id, project);
          cards.push(card);
          const version = await source.getCompatibleVersion(
            project.projectId,
            target,
          );
          if (!version) continue;

          const view = await mods.view(profile);
          const plan = await resolveInstall(source, version, target, view);
          const names = new Map(
            (
              await source.getProjects(projectsToName(plan)).catch(() => [])
            ).map((p) => [p.projectId, p.name]),
          );
          const incompatible = plan.incompatible.flatMap((projectId) =>
            view.enabledFromProject(source.id, projectId).map((m) => m.name),
          );
          Object.assign(card, describePlan(version, plan, names, incompatible));
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
                deps.downloadProgress({ planId, ...p });
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
     * Download the compatible version of every sourced library mod for a target
     * (version + loader), straight into the store. Mods with no version are skipped.
     */
    async downloadLibraryMods(target: {
      gameVersion: string;
      loaderId: string;
    }): Promise<BulkDownloadResult> {
      await whenReady();
      if (bulk) throw new AppError("MOD_BULK_BUSY", "A download is running.");
      const gameVersion = target.gameVersion;
      const loaderId = target.loaderId;
      if (typeof gameVersion !== "string" || typeof loaderId !== "string")
        throw new AppError("INVALID_TARGET", "Choose a version and a loader.");
      // Sourced library mods, grouped by source: projectId → its display name.
      const bySource = new Map<string, Map<string, string>>();
      for (const m of await mods.list()) {
        if (!m.source) continue;
        const byProject =
          bySource.get(m.source.sourceId) ?? new Map<string, string>();
        if (!byProject.has(m.source.projectId))
          byProject.set(m.source.projectId, m.name);
        bySource.set(m.source.sourceId, byProject);
      }
      const skipped: { name: string }[] = [];
      const downloaded = await fetchForTarget(
        { gameVersion, loaders: acceptedLoaders(loaderId) },
        [...bySource].map(([sourceId, byProject]) => ({
          sourceId,
          projectIds: [...byProject.keys()],
        })),
        (sourceId, res) => {
          const byProject = bySource.get(sourceId);
          for (const n of res.none)
            skipped.push({ name: byProject?.get(n.projectId) ?? n.projectId });
          return Promise.resolve();
        },
      );
      return { downloaded, skipped };
    },

    /**
     * After a profile's version changed: re-fetch each enabled sourced mod's version
     * for the new target and enable it (replacing the old one). Enabled sourced mods
     * with no compatible version are disabled but kept in the library; enabled mods
     * with no known source can't be re-fetched and are reported unresolved.
     */
    async applyProfileMods(profileId: string): Promise<ApplyModsResult> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      if (bulk) throw new AppError("MOD_BULK_BUSY", "A download is running.");
      const enabled = await mods.enabledMods(profileId);
      const unresolved = enabled
        .filter((m) => !m.meta.source)
        .map((m) => ({ name: m.meta.name }));
      const bySource = new Map<
        string,
        { projectId: string; sha1: string; name: string }[]
      >();
      for (const m of enabled) {
        if (!m.meta.source) continue;
        const list = bySource.get(m.meta.source.sourceId) ?? [];
        list.push({
          projectId: m.meta.source.projectId,
          sha1: m.sha1,
          name: m.meta.name,
        });
        bySource.set(m.meta.source.sourceId, list);
      }
      const disabled: { name: string }[] = [];
      const downloaded = await fetchForTarget(
        {
          gameVersion: profile.gameVersion,
          loaders: acceptedLoaders(profile.loader.id),
        },
        [...bySource].map(([sourceId, list]) => ({
          sourceId,
          projectIds: list.map((l) => l.projectId),
        })),
        async (sourceId, res) => {
          // The new versions replace the old ones (one version per mod id).
          if (res.found.length > 0)
            await serialFs(() =>
              mods.enableAll(
                profileId,
                res.found.map((f) => f.version.file.sha1),
              ),
            );
          const none = new Set(res.none.map((n) => n.projectId));
          for (const l of bySource.get(sourceId) ?? []) {
            if (!none.has(l.projectId)) continue;
            await serialFs(() => mods.disable(profileId, l.sha1));
            disabled.push({ name: l.name });
          }
        },
      );
      reports.clear();
      return { downloaded, disabled, unresolved };
    },

    /**
     * Newer versions of a profile's enabled mods, from the sites they came from.
     * Kept for a few minutes, so Update uses exactly what was shown.
     */
    async checkModUpdates(profileId: string): Promise<ModUpdateCheck> {
      const profile = await requireProfile(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      const manifest = profile.modpack
        ? await readManifest(paths, profileId)
        : undefined;
      const { check, versions } = await findModUpdates({
        sources,
        enabled: await mods.enabledMods(profileId),
        target: {
          gameVersion: profile.gameVersion,
          loaders: acceptedLoaders(profile.loader.id),
        },
        packFiles: new Set(Object.values(manifest?.files ?? {})),
      });
      updateChecks.set(profileId, { at: Date.now(), versions });
      return check;
    },

    /** Update these enabled mods to the versions the last check found (checked again if old). */
    async applyModUpdates(
      profileId: string,
      sha1s: string[],
    ): Promise<ModUpdateResult> {
      const profile = await requireProfile(profileId);
      assertNotRunning(profileId);
      if (!profile.loader)
        throw new AppError(
          "MOD_INCOMPATIBLE",
          "Vanilla profiles can't load mods.",
        );
      if (bulk) throw new AppError("MOD_BULK_BUSY", "A download is running.");
      let cached = updateChecks.get(profileId);
      if (!cached || Date.now() - cached.at > UPDATE_CHECK_TTL_MS) {
        await api.checkModUpdates(profileId);
        cached = updateChecks.get(profileId);
      }
      const enabled = await mods.enabledMods(profileId);
      const picks = enabled.flatMap((old) => {
        const version = sha1s.includes(old.sha1)
          ? cached?.versions.get(old.sha1)
          : undefined;
        return version ? [{ old, version }] : [];
      });
      const controller = new AbortController();
      bulk = controller;
      try {
        const result = await applyModUpdates(
          { downloader, paths, library: mods, sources },
          {
            profile,
            target: {
              gameVersion: profile.gameVersion,
              loaders: acceptedLoaders(profile.loader.id),
            },
            picks,
            serial: serialFs,
            signal: controller.signal,
            onProgress: (p) => {
              deps.bulkProgress(p);
            },
          },
        );
        updateChecks.delete(profileId);
        reports.clear();
        return result;
      } finally {
        bulk = undefined;
        changed();
      }
    },

    cancelBulkDownload(): void {
      bulk?.abort();
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
      await whenReady();
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
      await whenReady();
      const users = await mods.usedBy(sha1);
      if (users.length > 0 && !force)
        throw new AppError("MOD_IN_USE", "Profiles use this mod.");
      for (const id of users) assertNotRunning(id);
      await serialFs(() => mods.remove(sha1));
      changed();
    },

    async removeUnusedMods(): Promise<number> {
      await whenReady();
      await sync();
      const count = await serialFs(() => mods.removeUnused());
      changed();
      return count;
    },
  };

  return {
    api,
    scheduleIdentify,
    /** The data folder is moving: forget a pending identify. */
    stopIdentify(): void {
      if (identifyTimer) clearTimeout(identifyTimer);
      identifyTimer = undefined;
    },
    checkProfileMods,
    hasMod,
    /** A Modrinth download or a bulk download is running. */
    isBusy: (): boolean =>
      [...plans.values()].some((p) => p.controller) || bulk !== undefined,
  };
}

export type ModService = ReturnType<typeof createModService>;
