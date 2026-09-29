import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { WorldBackup, WorldInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatSize } from "../../lib/formatSize";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/** A world's backups: restore one as a new world, show it in the folder, or delete it. */
export function BackupsDialog({
  profileId,
  world,
  running,
  onClose,
}: {
  profileId: string;
  world: WorldInfo;
  /** The profile's game runs: restoring waits until it closes. */
  running: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const target = { profileId, worldId: world.id };
  const backups = useQuery({
    queryKey: ["backups", profileId, world.id],
    queryFn: () => invoke("backups:list", target),
  });
  const [deleting, setDeleting] = useState<WorldBackup>();
  const [notice, setNotice] = useState<string>();
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["backups"] });
    void queryClient.invalidateQueries({ queryKey: ["worlds"] });
  };

  const restore = useMutation({
    mutationFn: (backupId: string) =>
      invoke("backups:restore", { ...target, backupId }),
    onSuccess: (id) => {
      setNotice(t("backups.dialog.restored", { id }));
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (backupId: string) =>
      invoke("backups:delete", { ...target, backupId }),
    onSuccess: () => {
      setDeleting(undefined);
      refresh();
    },
  });
  const reveal = useMutation({
    mutationFn: (backupId: string) =>
      invoke("backups:reveal", { ...target, backupId }),
  });
  const error = restore.error ?? remove.error ?? reveal.error;
  const list = backups.data ?? [];

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("backups.dialog.title", { name: world.name })}
      description={t("backups.dialog.restoreHint")}
      closeLabel={t("backups.dialog.close")}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("backups.dialog.close")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {backups.isSuccess && list.length === 0 && (
          <p className="text-sm text-muted">{t("backups.dialog.empty")}</p>
        )}
        {list.length > 0 && (
          <ul className="max-h-[50vh] overflow-y-auto rounded-ezl border border-border">
            {list.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-medium">
                    {dateFormat.format(new Date(b.createdAt))}
                  </span>
                  <span className="text-xs text-muted">
                    {[
                      b.reason === "auto"
                        ? t("backups.dialog.auto")
                        : t("backups.dialog.manual"),
                      formatSize(t, b.sizeBytes),
                    ].join(" · ")}
                  </span>
                </div>
                <Button
                  disabled={running || restore.isPending}
                  title={running ? t("backups.runningBlocked") : undefined}
                  onClick={() => {
                    setNotice(undefined);
                    restore.mutate(b.id);
                  }}
                >
                  {t("backups.dialog.restore")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    reveal.mutate(b.id);
                  }}
                >
                  {t("backups.dialog.reveal")}
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    remove.reset();
                    setDeleting(b);
                  }}
                >
                  {t("backups.dialog.delete")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {notice && (
          <p className="text-sm text-success" aria-live="polite">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, error)}
          </p>
        )}
      </div>

      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(undefined);
          }}
          title={t("backups.dialog.deleteTitle")}
          description={t("backups.dialog.deleteBody", {
            date: dateFormat.format(new Date(deleting.createdAt)),
          })}
          closeLabel={t("backups.dialog.cancel")}
          footer={
            <>
              <Button
                onClick={() => {
                  setDeleting(undefined);
                }}
              >
                {t("backups.dialog.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(deleting.id);
                }}
              >
                {t("backups.dialog.deleteConfirm")}
              </Button>
            </>
          }
        />
      )}
    </Dialog>
  );
}
