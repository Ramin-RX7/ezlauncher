import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Play, TriangleAlert } from "lucide-react";
import type {
  LaunchRequest,
  ProfileInfo,
  QuickPlay,
  ValidationReport,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { launcherStore, useLauncherState } from "../../state/launcherStore";
import { useAccounts, useLoaders, useSelection } from "../../state/queries";
import { ProfileIcon } from "../profiles/ProfileIcon";
import { Button } from "../ui/Button";
import { InstallProgressRow } from "./InstallProgressRow";
import { LaunchProblemsDialog } from "./LaunchProblemsDialog";

/** A row's Play button asked to play this profile (`seq` tells repeated clicks apart). */
export interface PlayRequest {
  profileId: string;
  seq: number;
  /** Start straight into a world or onto a server. */
  quickPlay?: QuickPlay;
  /** What `quickPlay` is called (a world's name, a server's name), for the bar. */
  target?: string;
}

/** Play for the selected profile (the account is picked in the top bar), with install progress. */
export function PlayBar({
  profile,
  profiles = [],
  request,
}: {
  profile: ProfileInfo | undefined;
  /** All profiles, to name the one that crashed. */
  profiles?: ProfileInfo[];
  /** Play started from a profile row: runs once the row's profile is the selected one. */
  request?: PlayRequest;
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
  const [backupFailed, setBackupFailed] = useState<string[]>([]);
  const play = useMutation({
    onMutate: () => {
      setInstallIdBefore(launcherStore.getState().latestInstallId);
      launcherStore.dismissExit();
      setWarnings(0);
      setBackupFailed([]);
    },
    mutationFn: (request: LaunchRequest) => invoke("game:launch", request),
    onSuccess: (result, request) => {
      if (result.status === "blocked")
        setBlocked({ request, report: result.report });
      else {
        setWarnings(result.warnings);
        setBackupFailed(result.backupFailed ?? []);
      }
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
  // Each game of a profile needs its own account.
  const accountPlaying = useLauncherState((s) =>
    s.running.some(
      (g) => g.profileId === profile?.id && g.accountId === account?.id,
    ),
  );
  const busy = installing || play.isPending;

  // Played from a row: the row selects its profile first, then Play runs here, so
  // install progress and the mod-problems dialog show in this bar as usual.
  const handled = useRef(0);
  useEffect(() => {
    if (!request || request.seq === handled.current) return;
    if (request.profileId !== profile?.id) return; // not selected yet
    handled.current = request.seq;
    if (account && !busy && !accountPlaying) {
      const quickPlay = request.quickPlay;
      play.mutate({
        profileId: profile.id,
        accountId: account.id,
        ...(quickPlay && { quickPlay }),
      });
    }
  }, [request, profile, account, busy, accountPlaying, play]);
  // The world or server this start goes to, named as its row named it.
  const pendingQuickPlay = play.isPending
    ? play.variables.quickPlay
    : undefined;
  const quickPlayName = (q: QuickPlay) =>
    (request?.quickPlay === q ? request.target : undefined) ??
    (q.kind === "world" ? q.worldId : q.address);
  let label = profile?.installedVersionId
    ? t("play.play")
    : t("play.installAndPlay");
  // A backup before the start runs while Play is pending.
  const backingUp = useLauncherState(
    (s) => s.backup?.beforeStart === true && s.backup.profileId === profile?.id,
  );
  if (installing) label = t("play.installing");
  else if (play.isPending && backingUp) label = t("play.backingUp");
  else if (play.isPending && pendingQuickPlay)
    label =
      pendingQuickPlay.kind === "world"
        ? t("play.toWorld", { name: quickPlayName(pendingQuickPlay) })
        : t("play.toServer", { name: quickPlayName(pendingQuickPlay) });
  else if (play.isPending) label = t("play.starting");
  else if (running) label = t("play.playAnother");

  let hint: string | undefined;
  if (!profile && !account) hint = t("play.needBoth");
  else if (!profile) hint = t("play.needProfile");
  else if (!account) hint = t("play.needAccount");
  else if (accountPlaying)
    hint = t("play.accountPlaying", { name: account.username });
  else if (running) hint = t("play.runningHint");

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
        {profile && <ProfileIcon profile={profile} />}
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
          disabled={!profile || !account || busy || accountPlaying}
          aria-describedby={hint ? "play-hint" : undefined}
          onClick={() => {
            if (!profile || !account) return;
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
        <InstallProgressRow
          versionId={installKey}
          progress={install.progress}
        />
      )}

      {blocked && profile && (
        <LaunchProblemsDialog
          profile={profile}
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
      {backupFailed.length > 0 && !play.isPending && (
        <p className="flex items-center gap-2 text-xs text-warning">
          <TriangleAlert size={14} aria-hidden />
          {t("play.backupFailed", { names: backupFailed.join(", ") })}
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
