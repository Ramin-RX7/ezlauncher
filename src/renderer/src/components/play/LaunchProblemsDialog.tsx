import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LaunchRequest, ValidationReport } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { IssueList } from "../mods/IssueList";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * Play found mod errors. Lists them by mod, then lets the user disable the problem
 * mods (seeing the final list first), play anyway, or go back.
 */
export function LaunchProblemsDialog({
  profileId,
  report,
  onPlay,
  onClose,
}: {
  profileId: string;
  report: ValidationReport;
  onPlay: (problems: NonNullable<LaunchRequest["problems"]>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const library = useQuery({
    queryKey: ["mods", "library", profileId],
    queryFn: () => invoke("mods:library", { profileId }),
  });
  const plan = useQuery({
    queryKey: ["mods", "disablePlan", profileId],
    queryFn: () => invoke("mods:disablePlan", profileId),
    enabled: confirming,
  });

  const errors = report.issues.filter((i) => i.severity === "error");
  const bySha1 = [...new Set(errors.map((i) => i.modSha1))];
  const nameOf = (sha1: string) =>
    library.data?.find((m) => m.sha1 === sha1)?.name ?? sha1.slice(0, 8);

  const footer = confirming ? (
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
          if (plan.data) onPlay({ disable: plan.data.mods.map((m) => m.sha1) });
        }}
      >
        {t("launchProblems.confirm")}
      </Button>
    </>
  ) : (
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("launchProblems.title")}
      description={
        confirming ? t("launchProblems.confirmBody") : t("launchProblems.body")
      }
      closeLabel={t("launchProblems.close")}
      footer={footer}
    >
      <div className="flex max-h-[50vh] flex-col gap-3 overflow-auto">
        {!confirming &&
          bySha1.map((sha1) => (
            <section key={sha1} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{nameOf(sha1)}</h3>
              <IssueList issues={errors.filter((i) => i.modSha1 === sha1)} />
            </section>
          ))}
        {confirming && plan.isPending && (
          <p className="text-sm text-muted">
            {t("launchProblems.loadingPlan")}
          </p>
        )}
        {confirming && plan.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, plan.error)}
          </p>
        )}
        {confirming && plan.data && (
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
    </Dialog>
  );
}
