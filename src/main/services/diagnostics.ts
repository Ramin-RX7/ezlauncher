import { basename, join } from "node:path";
import type {
  JavaListResult,
  LauncherSettings,
  ValidationReport,
} from "@shared/launcher";
import type { Account } from "../auth/types";
import type { DiagnosticsInput } from "../diagnostics/diagnostics";
import {
  LOG_SECTION_BYTES,
  newestFile,
  readHead,
  readTail,
} from "../diagnostics/logTail";
import type { Paths } from "../minecraft/paths";
import type { ModLibrary } from "../profiles/mods";
import type { PlayTime } from "../profiles/playTime";
import type { ProfileStore } from "../profiles/profiles";

export interface DiagnosticsDeps {
  paths: Paths;
  settings: { load: () => Promise<LauncherSettings> };
  accounts: { list: () => Promise<Account[]> };
  profiles: Pick<ProfileStore, "list">;
  mods: Pick<ModLibrary, "enabledMods">;
  playTime: Pick<PlayTime, "totals">;
  listJava: () => Promise<JavaListResult>;
  validateMods: (profileId: string) => Promise<ValidationReport>;
  /** A game of the profile runs or is starting. */
  isBusy: (profileId: string) => boolean;
}

/** The data-folder part of "Copy diagnostics" (redacted later, by `formatDiagnostics`). */
export function createDiagnostics(deps: DiagnosticsDeps) {
  const { paths, settings, accounts, profiles, mods, playTime, isBusy } = deps;

  return {
    /**
     * The data-folder part of "Copy diagnostics": settings, Java, and one profile
     * (the given one, else the selected one) with its mods, mod check and game
     * logs. Never fails: what can't be read is left out.
     */
    async collect(profileId?: string): Promise<
      Pick<DiagnosticsInput, "settings" | "java" | "profile"> & {
        secrets: { dataDir: string; playerNames: string[]; uuids: string[] };
      }
    > {
      const config = await settings.load().catch(() => undefined);
      const accountList = await accounts.list().catch(() => []);
      const javaList = await deps.listJava().catch(() => undefined);
      const id = profileId ?? config?.selectedProfileId ?? undefined;
      const profile = id
        ? (await profiles.list().catch(() => [])).find((p) => p.id === id)
        : undefined;

      let profileInfo: DiagnosticsInput["profile"];
      if (profile) {
        const enabled = await mods.enabledMods(profile.id).catch(() => []);
        const report = profile.loader
          ? await deps.validateMods(profile.id).catch(() => undefined)
          : undefined;
        const names = new Map(enabled.map((m) => [m.sha1, m.meta.name]));
        const crash = await newestFile(
          join(paths.gameDir(profile.id), "crash-reports"),
        );
        const played = await playTime.totals().catch(() => undefined);
        profileInfo = {
          name: profile.name,
          gameVersion: profile.gameVersion,
          ...(profile.loader && { loader: profile.loader.id }),
          ...(profile.loader?.version && {
            loaderBuild: profile.loader.version,
          }),
          ...(profile.installedVersionId && {
            installedVersionId: profile.installedVersionId,
          }),
          ...(profile.modpack && {
            modpack: `${profile.modpack.name} ${profile.modpack.versionNumber}`,
          }),
          ...(profile.memoryMaxMb !== undefined && {
            memoryMaxMb: profile.memoryMaxMb,
          }),
          ...(profile.extraJvmArgs && {
            extraJvmArgs: profile.extraJvmArgs.length,
          }),
          ...(profile.extraGameArgs && {
            extraGameArgs: profile.extraGameArgs.length,
          }),
          running: isBusy(profile.id),
          ...(played?.get(profile.id) && {
            playTimeMs: played.get(profile.id),
          }),
          mods: enabled
            .map((m) => ({
              name: m.meta.name,
              ...(m.meta.version && { version: m.meta.version }),
              ...(m.meta.modId && { modId: m.meta.modId }),
              fromModrinth: m.meta.source !== undefined,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          issues: (report?.issues ?? []).map(
            (i) =>
              `${i.severity} ${i.code} (${names.get(i.modSha1) ?? i.modSha1.slice(0, 8)})`,
          ),
          ...(crash && {
            crashReport: {
              name: basename(crash.path),
              modifiedAt: crash.modifiedAt.toISOString(),
              head: (await readHead(crash.path, 60, LOG_SECTION_BYTES)) ?? "",
            },
          }),
          ...(await readTail(
            join(paths.gameDir(profile.id), "logs", "latest.log"),
            150,
            LOG_SECTION_BYTES,
          ).then((latestLog) => (latestLog ? { latestLog } : {}))),
        };
      }

      return {
        ...(config && {
          settings: {
            memoryMaxMb: config.memoryMaxMb,
            onGameStart: config.onGameStart,
            extraJvmArgs: config.extraJvmArgs.length,
            extraGameArgs: config.extraGameArgs.length,
          },
        }),
        ...(javaList && {
          java: [
            ...javaList.runtimes
              .filter((r) => r.installed)
              .map(
                (r) =>
                  `Mojang ${r.component}${r.versionName ? ` ${r.versionName}` : ""}`,
              ),
            ...javaList.system.map(
              (s) =>
                `System Java ${s.version ?? "?"}${s.vendor ? ` (${s.vendor})` : ""}`,
            ),
          ],
        }),
        ...(profileInfo && { profile: profileInfo }),
        secrets: {
          dataDir: paths.dataDir,
          playerNames: accountList.map((a) => a.username),
          uuids: accountList.map((a) => a.uuid),
        },
      };
    },
  };
}
