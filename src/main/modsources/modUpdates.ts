import type {
  ModUpdate,
  ModUpdateCheck,
  ModUpdateResult,
  Profile,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import type { DownloadProgress } from "../minecraft/downloader";
import type { ModMeta } from "../profiles/mods";
import { storeVersions, type DownloadModsDeps } from "./downloadMods";
import { resolveInstall, type InstallPlan } from "./resolveDependencies";
import type { ModSource, ModTarget, RemoteVersion } from "./types";

/*
 * Mod updates for one profile: which enabled mods have a newer version that fits
 * the profile, and putting the picked ones in. The old jars stay in the library,
 * so the Mods tab's version picker can go back.
 */

export interface EnabledMod {
  sha1: string;
  meta: ModMeta;
}

/** Mod versions don't say their channel in the jar: "1.2.0-beta.3" or "2.0-rc1" isn't a release. */
export function looksLikeRelease(version: string | undefined): boolean {
  return !/(alpha|beta|pre|rc|snapshot)/i.test(version ?? "");
}

export interface FoundUpdates {
  check: ModUpdateCheck;
  /** The new version for each enabled jar (by its SHA1) that has one. */
  versions: Map<string, RemoteVersion>;
}

/**
 * Ask each site, in one batch per site, for the newest version of every enabled
 * mod it knows. A release stays on releases: a newer beta isn't offered over it.
 * `packFiles` are SHA1s a mod pack wrote (its own update changes those).
 */
export async function findModUpdates({
  sources,
  enabled,
  target,
  packFiles = new Set(),
  signal,
}: {
  sources: { get(id: string): ModSource };
  enabled: readonly EnabledMod[];
  target: ModTarget;
  packFiles?: ReadonlySet<string>;
  signal?: AbortSignal;
}): Promise<FoundUpdates> {
  const check: ModUpdateCheck = { updates: [], upToDate: 0, unknown: [] };
  const versions = new Map<string, RemoteVersion>();
  const bySource = new Map<string, EnabledMod[]>();
  for (const m of enabled) {
    if (!m.meta.source) {
      check.unknown.push({ name: m.meta.name });
      continue;
    }
    const list = bySource.get(m.meta.source.sourceId) ?? [];
    list.push(m);
    bySource.set(m.meta.source.sourceId, list);
  }
  for (const [sourceId, list] of bySource) {
    const source = sources.get(sourceId);
    const latest = await source.latestVersions(
      list.map((m) => m.sha1),
      target,
      signal,
    );
    for (const m of list) {
      let next = latest.get(m.sha1);
      if (
        next &&
        next.channel !== "release" &&
        looksLikeRelease(m.meta.version)
      ) {
        const release = await source
          .getCompatibleVersion(next.projectId, target, signal)
          .catch(() => null);
        next = release?.channel === "release" ? release : undefined;
      }
      if (
        !next ||
        next.file.sha1 === m.sha1 ||
        next.versionId === m.meta.source?.versionId
      ) {
        check.upToDate++;
        continue;
      }
      versions.set(m.sha1, next);
      const update: ModUpdate = {
        sha1: m.sha1,
        name: m.meta.name,
        ...(m.meta.version && { fromVersion: m.meta.version }),
        toVersion: next.versionNumber,
        channel: next.channel,
        ...(next.published && { published: next.published }),
        size: next.file.size,
        ...(next.changelog && { changelog: next.changelog }),
        pageUrl: source.pageUrl(next.projectId),
        fromPack: packFiles.has(m.sha1),
      };
      check.updates.push(update);
    }
  }
  check.updates.sort((a, b) => a.name.localeCompare(b.name));
  return { check, versions };
}

export interface ApplyUpdatesOptions {
  profile: Pick<Profile, "id" | "gameVersion" | "loader">;
  target: ModTarget;
  /** Enabled jar → its new version (from `findModUpdates`). */
  picks: { old: EnabledMod; version: RemoteVersion }[];
  /** Runs the steps that change files (the service's one-at-a-time queue). */
  serial?: <T>(fn: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
}

/**
 * Download each picked update with the required mods it newly needs, then enable
 * them. Mods with a mod id replace their old version by the library's one-version
 * rule; jars without one are unlinked here. An update keeps how the mod came in
 * (yours or a dependency). A failed batch takes back what it stored.
 */
export async function applyModUpdates(
  deps: Omit<DownloadModsDeps, "source"> & {
    sources: { get(id: string): ModSource };
  },
  {
    profile,
    target,
    picks,
    serial = (fn) => fn(),
    signal,
    onProgress,
  }: ApplyUpdatesOptions,
): Promise<ModUpdateResult> {
  const result: ModUpdateResult = { updated: [], failed: [] };
  const view = await deps.library.view(profile);
  const bySource = new Map<
    string,
    { old: EnabledMod; plan: InstallPlan; version: RemoteVersion }[]
  >();
  for (const { old, version } of picks) {
    const source = deps.sources.get(version.sourceId);
    try {
      const plan = await resolveInstall(source, version, target, view, signal);
      if (plan.missing.length > 0) {
        result.failed.push({
          name: old.meta.name,
          code: "MOD_DEPENDENCY_MISSING",
        });
        continue;
      }
      const list = bySource.get(source.id) ?? [];
      list.push({ old, plan, version });
      bySource.set(source.id, list);
    } catch (err) {
      if (err instanceof AppError && err.code === "CANCELLED") throw err;
      result.failed.push({
        name: old.meta.name,
        code: err instanceof AppError ? err.code : "DOWNLOAD_FAILED",
      });
    }
  }

  for (const [sourceId, list] of bySource) {
    const source = deps.sources.get(sourceId);
    const roots = new Map(
      list.map((l) => [l.version.file.sha1, l.old.meta.addedAs ?? "user"]),
    );
    const items = list.flatMap((l) => l.plan.items);
    await serial(() =>
      storeVersions(
        { ...deps, source },
        items.flatMap((i) => (i.action === "download" ? [i.version] : [])),
        {
          ...(signal && { signal }),
          ...(onProgress && { onProgress }),
          addedAs: (v) => roots.get(v.file.sha1) ?? "dependency",
        },
      ),
    );
    await serial(async () => {
      await deps.library.enableAll(
        profile.id,
        items.map((i) =>
          i.action === "download" ? i.version.file.sha1 : i.sha1,
        ),
      );
      for (const l of list)
        if (!l.old.meta.modId)
          await deps.library.disable(profile.id, l.old.sha1);
    });
    for (const l of list)
      result.updated.push({
        name: l.old.meta.name,
        ...(l.old.meta.version && { from: l.old.meta.version }),
        to: l.version.versionNumber,
      });
  }
  return result;
}
