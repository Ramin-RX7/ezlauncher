import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Play, TriangleAlert, X } from "lucide-react";
import type {
  LaunchRequest,
  ProfileInfo,
  ValidationReport,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { launcherStore, useLauncherState } from "../../state/launcherStore";
import { useAccounts, useLoaders, useSelection } from "../../state/queries";
import { AccountPicker } from "../accounts/AccountPicker";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";
import { LaunchProblemsDialog } from "./LaunchProblemsDialog";

const MB = 1024 * 1024;

/** Account choice and Play for the selected profile, with install progress. */
export function PlayBar({
  profile,
  profiles = [],
}: {
  profile: ProfileInfo | undefined;
  /** All profiles, to name the one that crashed. */
  profiles?: ProfileInfo[];
}) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const loaders = useLoaders();
  const { accountId } = useSelection();
  const account = accounts.data?.find((a) => a.id === accountId);

  // A new install's version id is only known once it starts, so follow the
  // install that started after Play was pressed.
  const latestInstallId = useLauncherState((s) => s.latestInstallId);
  const [installIdBefore, setInstallIdBefore] = useState<string>();
  const queryClient = useQueryClient();
  /** Mod errors found at Play: the user decides what to do. */
  const [blocked, setBlocked] = useState<{
    request: LaunchRequest;
    report: ValidationReport;
  }>();
  const [warnings, setWarnings] = useState(0);
  const play = useMutation({
    onMutate: () => {
      setInstallIdBefore(launcherStore.getState().latestInstallId);
      launcherStore.dismissExit();
      setWarnings(0);
    },
    mutationFn: (request: LaunchRequest) => invoke("game:launch", request),
    onSuccess: (result, request) => {
      if (result.status === "blocked")
        setBlocked({ request, report: result.report });
      else setWarnings(result.warnings);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });
  const newInstallId =
    latestInstallId !== installIdBefore ? latestInstallId : undefined;
  const installKey = play.isPending
    ? (newInstallId ?? profile?.installedVersionId)
    : profile?.installedVersionId;
  const install = useLauncherState((s) =>
    installKey ? s.installs[installKey] : undefined,
  );
  const lastExit = useLauncherState((s) => s.lastExit);
  const installing =
    install?.status === "queued" || install?.status === "running";

  const running = (profile?.running ?? 0) > 0;
  const busy = installing || play.isPending;
  let label = profile?.installedVersionId
    ? t("play.play")
    : t("play.installAndPlay");
  if (installing) label = t("play.installing");
  else if (play.isPending) label = t("play.starting");
  else if (running) label = t("play.running");

  let hint: string | undefined;
  if (!profile && !account) hint = t("play.needBoth");
  else if (!profile) hint = t("play.needProfile");
  else if (!account) hint = t("play.needAccount");

  const p = install?.progress;
  const percent =
    p && p.totalBytes > 0
      ? (p.bytes / p.totalBytes) * 100
      : p && p.totalFiles > 0
        ? (p.files / p.totalFiles) * 100
        : undefined;
  const loaderName = profile?.loader
    ? (loaders.data?.find((l) => l.id === profile.loader?.id)?.displayName ??
      profile.loader.id)
    : undefined;
  const crashedName =
    profiles.find((x) => x.id === lastExit?.profileId)?.name ??
    lastExit?.versionId;

  return (
    <section className="flex flex-col gap-3 rounded-ezl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-4">
        <AccountPicker />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            {profile
              ? [profile.gameVersion, loaderName].filter(Boolean).join(" · ")
              : " "}
          </div>
          <div className="truncate text-lg font-semibold">
            {profile?.name ?? t("profiles.choose")}
          </div>
        </div>
        <Button
          variant="primary"
          className="h-11 min-w-44 text-base"
          disabled={!profile || !account || busy || running}
          aria-describedby={hint ? "play-hint" : undefined}
          onClick={() => {
            if (profile && account)
              play.mutate({ profileId: profile.id, accountId: account.id });
          }}
        >
          <Play size={18} aria-hidden />
          {label}
        </Button>
      </div>

      {hint && (
        <p id="play-hint" className="text-xs text-muted">
          {hint}
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

      {blocked && (
        <LaunchProblemsDialog
          profileId={blocked.request.profileId}
          report={blocked.report}
          onClose={() => {
            setBlocked(undefined);
          }}
          onPlay={(problems) => {
            const { request } = blocked;
            setBlocked(undefined);
            play.mutate({ ...request, problems });
          }}
        />
      )}
      {warnings > 0 && !play.isPending && (
        <p className="flex items-center gap-2 text-xs text-warning">
          <TriangleAlert size={14} aria-hidden />
          {t("launchProblems.warnings", { count: warnings })}
        </p>
      )}
      {play.isError && !isCancelled(play.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, play.error)}
        </p>
      )}
      {lastExit?.crashed && (
        <p role="alert" className="text-sm text-danger">
          {t("play.crashed", {
            name: crashedName ?? "",
            code: String(lastExit.code),
          })}
        </p>
      )}
    </section>
  );
}

function isCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "CANCELLED"
  );
}
