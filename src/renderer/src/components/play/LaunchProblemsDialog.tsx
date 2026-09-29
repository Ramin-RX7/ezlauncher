import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import type {
  LaunchRequest,
  ProfileInfo,
  ValidationReport,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { AddModDialog } from "../mods/AddModDialog";
import { IssueList } from "../mods/IssueList";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * Play found mod errors. Lists them by mod, with Download / Re-download fixes, then
 * lets the user disable the problem mods (seeing the final list first), play anyway,
 * or go back. After a fix the mods are checked again; with no errors left, it's Play.
 */
export function LaunchProblemsDialog({
  profile,
  report: firstReport,
  onPlay,
  onClose,
}: {
  profile: ProfileInfo;
  report: ValidationReport;
  onPlay: (problems: NonNullable<LaunchRequest["problems"]>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const profileId = profile.id;
  const [confirming, setConfirming] = useState(false);
  const [searching, setSearching] = useState<string>();
  const library = useQuery({
    queryKey: ["mods", "library", profileId],
    queryFn: () => invoke("mods:library", { profileId }),
  });
  // Starts from Play's report; a fix invalidates it, and it's checked again.
  const live = useQuery({
    queryKey: ["mods", "validate", profileId],
    queryFn: () => invoke("mods:validate", { profileId }),
    initialData: firstReport,
    staleTime: Infinity,
  });
  const report = live.data;
  const plan = useQuery({
    queryKey: ["mods", "disablePlan", profileId],
    queryFn: () => invoke("mods:disablePlan", profileId),
    enabled: confirming,
  });
  const redownload = useMutation({
    mutationFn: (sha1: string) => invoke("mods:redownload", sha1),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });

  const errors = report.issues.filter((i) => i.severity === "error");
  const bySha1 = [...new Set(errors.map((i) => i.modSha1))];
  const nameOf = (sha1: string) =>
    library.data?.find((m) => m.sha1 === sha1)?.name ?? sha1.slice(0, 8);
  const fixed = errors.length === 0;

  let footer;
  if (fixed) {
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t("launchProblems.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onPlay("check");
          }}
        >
          {t("launchProblems.play")}
        </Button>
      </>
    );
  } else if (confirming) {
    footer = (
      <>
        <Button
          variant="ghost"
          onClick={() => {
            setConfirming(false);
          }}
        >
          {t("launchProblems.back")}
        </Button>
        <Button
          variant="primary"
          disabled={!plan.data}
          onClick={() => {
            if (plan.data)
              onPlay({ disable: plan.data.mods.map((m) => m.sha1) });
          }}
        >
          {t("launchProblems.confirm")}
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t("launchProblems.cancel")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onPlay("ignore");
          }}
        >
          {t("launchProblems.playAnyway")}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t("launchProblems.disableAndPlay")}
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("launchProblems.title")}
      description={
        fixed
          ? undefined
          : confirming
            ? t("launchProblems.confirmBody")
            : t("launchProblems.body")
      }
      closeLabel={t("launchProblems.close")}
      footer={footer}
    >
      <div className="flex max-h-[50vh] flex-col gap-3 overflow-auto">
        {fixed && (
          <p
            className="flex items-center gap-2 text-sm text-success"
            aria-live="polite"
          >
            <CircleCheck size={16} aria-hidden />
            {t("launchProblems.fixed")}
          </p>
        )}
        {!fixed &&
          !confirming &&
          bySha1.map((sha1) => (
            <section key={sha1} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{nameOf(sha1)}</h3>
              <IssueList
                issues={errors.filter((i) => i.modSha1 === sha1)}
                busy={redownload.isPending || live.isFetching}
                onDownload={setSearching}
                onRedownload={() => {
                  redownload.mutate(sha1);
                }}
              />
            </section>
          ))}
        {redownload.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, redownload.error)}
          </p>
        )}
        {!fixed && confirming && plan.isPending && (
          <p className="text-sm text-muted">
            {t("launchProblems.loadingPlan")}
          </p>
        )}
        {!fixed && confirming && plan.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, plan.error)}
          </p>
        )}
        {!fixed && confirming && plan.data && (
          <ul className="flex flex-col gap-1 text-sm">
            {plan.data.mods.map((m) => (
              <li key={m.sha1}>
                <span className="font-medium">{m.name}</span>{" "}
                <span className="text-muted">
                  {m.reason === "error"
                    ? t("launchProblems.reasonError")
                    : t("launchProblems.reasonDependency")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {searching !== undefined && (
        <AddModDialog
          profile={profile}
          initialQuery={searching}
          autoSearch
          onClose={() => {
            setSearching(undefined);
            void queryClient.invalidateQueries({ queryKey: ["mods"] });
          }}
        />
      )}
    </Dialog>
  );
}
