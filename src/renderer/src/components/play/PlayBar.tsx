import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Play, X } from "lucide-react";
import {
  USERNAME_PATTERN,
  type LaunchTarget,
  type LoaderInfo,
  type VersionSummary,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { launcherStore, useLauncherState } from "../../state/launcherStore";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Progress } from "../ui/Progress";
import { Select } from "../ui/Select";

const MB = 1024 * 1024;
const VANILLA = "vanilla";

export interface PlayBarProps {
  /** The Minecraft version picked in the list. */
  version: VersionSummary | undefined;
  loaders?: LoaderInfo[];
  /** The picked loader; null = Vanilla. */
  loaderId?: string | null;
  onLoaderChange?: (loaderId: string | null) => void;
  /** Installed loader installs of this version (by loader id); they always stay playable. */
  installedLoaders?: Record<string, VersionSummary>;
}

export function PlayBar({
  version,
  loaders = [],
  loaderId = null,
  onLoaderChange,
  installedLoaders = {},
}: PlayBarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["account"],
    queryFn: () => invoke("account:get"),
  });
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const username = draft ?? account.data?.username ?? "";
  const validName = USERNAME_PATTERN.test(username.trim());

  const loader = loaders.find((l) => l.id === loaderId);
  const supports = (l: LoaderInfo) =>
    version !== undefined &&
    (installedLoaders[l.id] !== undefined ||
      (l.gameVersions?.includes(version.id) ?? false));
  const loaderUnavailable = loaderId !== null && (!loader || !supports(loader));

  // What Play starts: an installed version, or a new loader install.
  const installedEntry = loaderId
    ? installedLoaders[loaderId]
    : version?.installed
      ? version
      : undefined;
  const target: LaunchTarget | undefined = !version
    ? undefined
    : installedEntry
      ? { versionId: installedEntry.id }
      : loaderId
        ? { gameVersion: version.id, loaderId }
        : { versionId: version.id };

  // A new loader install's version id is only known once its install starts.
  const latestInstallId = useLauncherState((s) => s.latestInstallId);
  const [installIdBefore, setInstallIdBefore] = useState<string>();
  const newInstallId =
    latestInstallId !== installIdBefore ? latestInstallId : undefined;

  const play = useMutation({
    onMutate: () => {
      setInstallIdBefore(launcherStore.getState().latestInstallId);
    },
    mutationFn: async (launchTarget: LaunchTarget) => {
      const name = username.trim();
      if (name !== account.data?.username) {
        const saved = await invoke("account:setUsername", name);
        queryClient.setQueryData(["account"], saved);
        setDraft(undefined);
      }
      launcherStore.dismissExit();
      return invoke("game:launch", launchTarget);
    },
  });

  const installKey =
    target && "versionId" in target
      ? target.versionId
      : play.isPending
        ? newInstallId
        : undefined;
  const install = useLauncherState((s) =>
    installKey ? s.installs[installKey] : undefined,
  );
  const running = useLauncherState((s) =>
    s.running.some((g) => g.versionId === installKey),
  );
  const lastExit = useLauncherState((s) => s.lastExit);
  const installing =
    install?.status === "queued" || install?.status === "running";

  const busy = installing || play.isPending;
  let label = installedEntry ? t("play.play") : t("play.installAndPlay");
  if (installing) label = t("play.installing");
  else if (play.isPending) label = t("play.starting");
  else if (running) label = t("play.running");

  const p = install?.progress;
  const percent =
    p && p.totalBytes > 0
      ? (p.bytes / p.totalBytes) * 100
      : p && p.totalFiles > 0
        ? (p.files / p.totalFiles) * 100
        : undefined;

  return (
    <section className="flex flex-col gap-3 rounded-ezl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("play.username")}</span>
          <Input
            value={username}
            placeholder={t("play.usernamePlaceholder")}
            maxLength={16}
            aria-invalid={username.length > 0 && !validName}
            aria-describedby="username-rule"
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            className="w-52"
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            {version ? typeLabel(t, version.type) : "\u00a0"}
          </div>
          <div className="truncate text-lg font-semibold">
            {version?.id ?? t("play.noVersion")}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("loaders.label")}</span>
          <Select
            value={loaderId ?? VANILLA}
            disabled={!version || busy}
            onChange={(value) =>
              onLoaderChange?.(value === VANILLA ? null : value)
            }
            className="w-56"
            options={[
              { value: VANILLA, label: t("loaders.vanilla") },
              ...loaders.map((l) => {
                const ok = supports(l);
                const installedBuild = installedLoaders[l.id]?.loader;
                return {
                  value: l.id,
                  label: installedBuild
                    ? t("loaders.badge", {
                        name: l.displayName,
                        version: installedBuild.loaderVersion,
                      })
                    : ok
                      ? l.displayName
                      : t("loaders.unsupported", { name: l.displayName }),
                  disabled: !ok,
                };
              }),
            ]}
          />
        </label>
        <Button
          variant="primary"
          className="h-11 min-w-44 text-base"
          disabled={
            !target || !validName || busy || running || loaderUnavailable
          }
          onClick={() => {
            if (target) play.mutate(target);
          }}
        >
          <Play size={18} aria-hidden />
          {label}
        </Button>
      </div>

      <p
        id="username-rule"
        className={`text-xs ${username.length > 0 && !validName ? "text-danger" : "text-muted"}`}
      >
        {t("play.usernameRule")}
      </p>

      {loaderUnavailable && version && (
        <p className="text-xs text-danger">
          {t("loaders.unsupportedHint", {
            name: loader?.displayName ?? loaderId,
            version: version.id,
          })}
        </p>
      )}

      {installing && installKey && (
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex justify-between gap-2 text-xs text-muted">
              <span>
                {p ? t(`play.steps.${p.step}`) : t("play.installing")}
              </span>
              {p && p.totalFiles > 0 && (
                <span>
                  {t("play.progress", {
                    files: p.files,
                    totalFiles: p.totalFiles,
                    mb: (p.bytes / MB).toFixed(1),
                    totalMb: (p.totalBytes / MB).toFixed(1),
                  })}
                </span>
              )}
            </div>
            <Progress value={percent} label={t("play.installing")} />
          </div>
          <Button
            variant="ghost"
            aria-label={t("play.cancel")}
            onClick={() => {
              void invoke("versions:cancel", installKey);
            }}
          >
            <X size={16} aria-hidden />
            {t("play.cancel")}
          </Button>
        </div>
      )}

      {play.isError && !isCancelled(play.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, play.error)}
        </p>
      )}
      {lastExit?.crashed && (
        <p role="alert" className="text-sm text-danger">
          {t("play.crashed", {
            id: lastExit.versionId,
            code: String(lastExit.code),
          })}
        </p>
      )}
    </section>
  );
}

const TYPES = ["release", "snapshot", "old_beta", "old_alpha"] as const;

function typeLabel(t: TFunction, type: string): string {
  const known = TYPES.find((k) => k === type);
  return known ? t(`versions.types.${known}`) : type;
}

function isCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "CANCELLED"
  );
}
