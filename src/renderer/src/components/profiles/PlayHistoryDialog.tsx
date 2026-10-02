import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ProfileInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatDuration } from "../../lib/formatDuration";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/** A profile's play time and its sessions, newest first. */
export function PlayHistoryDialog({
  profile,
  onClose,
}: {
  profile: ProfileInfo;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const history = useQuery({
    queryKey: ["profiles", "playHistory", profile.id],
    queryFn: () => invoke("profiles:playHistory", profile.id),
  });
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );
  const sessions = history.data?.sessions ?? [];

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("playTime.historyTitle", { name: profile.name })}
      description={t("playTime.total", {
        time: formatDuration(
          t,
          history.data?.totalMs ?? profile.playTimeMs ?? 0,
        ),
      })}
      closeLabel={t("playTime.close")}
      footer={<Button onClick={onClose}>{t("playTime.close")}</Button>}
    >
      {history.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, history.error)}
        </p>
      )}
      {history.isSuccess && sessions.length === 0 && (
        <p className="text-sm text-muted">{t("playTime.none")}</p>
      )}
      {sessions.length > 0 && (
        <ul className="flex max-h-[55vh] flex-col overflow-auto rounded-ezl border border-border">
          {sessions.map((s) => (
            <li
              key={s.startedAt}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-sm last:border-b-0"
            >
              <span className="min-w-40">
                {dateFormat.format(new Date(s.startedAt))}
              </span>
              <span className="font-medium">
                {s.approx
                  ? t("playTime.about", {
                      time: formatDuration(t, s.durationMs),
                    })
                  : formatDuration(t, s.durationMs)}
              </span>
              <span className="text-muted">
                {s.accountName ?? t("playTime.removedAccount")}
              </span>
              {s.quickPlay && (
                <span className="truncate text-xs text-muted">
                  {s.quickPlay.kind === "world"
                    ? t("playTime.inWorld", { name: s.quickPlay.worldId })
                    : t("playTime.onServer", { name: s.quickPlay.address })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
