import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AvailableUpdate, UpdateState } from "@shared/updates";
import { invoke, IpcCallError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatSize } from "../../lib/formatSize";
import { ReleaseNotes } from "../../lib/releaseNotes";
import { stateUpdate, useUpdateState } from "../../state/updates";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Progress } from "../ui/Progress";

function formatDate(language: string, date: string): string {
  const ms = Date.parse(date);
  return Number.isNaN(ms)
    ? date
    : new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(ms);
}

/** What's new in the available update, and downloading / installing it. */
export function UpdateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { data: state } = useUpdateState();
  const [actionError, setActionError] = useState<unknown>();
  const update = stateUpdate(state);
  if (!state || !update) return null;

  const run = (action: () => Promise<unknown>) => {
    setActionError(undefined);
    action().catch((err: unknown) => {
      // Failed downloads and installs show in the state; "busy" leaves it ready.
      if (err instanceof IpcCallError && err.code === "UPDATE_BUSY")
        setActionError(err);
    });
  };
  const download = () => {
    run(() => invoke("updates:download"));
  };
  const close = () => {
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={t("updates.title", { version: update.version })}
      description={t("updates.released", {
        date: formatDate(i18n.language, update.date),
      })}
      closeLabel={t("updates.close")}
      footer={
        <Footer
          state={state}
          update={update}
          onDownload={download}
          onCancel={() => {
            run(() => invoke("updates:cancel"));
          }}
          onRestart={() => {
            run(() => invoke("updates:install", { restart: true }));
          }}
          onClose={close}
        />
      }
    >
      <div className="flex max-h-[50vh] flex-col gap-5 overflow-auto pe-2">
        {update.notes.map((n) => (
          <section key={n.version} className="flex flex-col gap-2">
            {update.notes.length > 1 && (
              <h3 className="font-semibold">
                {n.version}{" "}
                <span className="text-sm font-normal text-muted">
                  {formatDate(i18n.language, n.date)}
                </span>
              </h3>
            )}
            <ReleaseNotes markdown={n.notes} />
          </section>
        ))}
      </div>
      <Status state={state} update={update} />
      {actionError !== undefined && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(t, actionError)}
        </p>
      )}
    </Dialog>
  );
}

function Status({
  state,
  update,
}: {
  state: UpdateState;
  update: AvailableUpdate;
}) {
  const { t } = useTranslation();
  if (state.status === "downloading")
    return (
      <div className="mt-4 flex flex-col gap-2">
        <Progress
          label={t("updates.downloadLabel")}
          value={state.total ? (state.received / state.total) * 100 : undefined}
        />
        <p className="text-sm text-muted">
          {t("updates.downloading", {
            received: formatSize(t, state.received),
            total: formatSize(t, state.total),
          })}
        </p>
      </div>
    );
  if (state.status === "ready")
    return <p className="mt-4 text-sm text-muted">{t("updates.readyHint")}</p>;
  if (state.status === "installing")
    return <p className="mt-4 text-sm text-muted">{t("updates.installing")}</p>;
  if (state.status === "error")
    return (
      <p role="alert" className="mt-4 text-sm text-danger">
        {errorMessage(t, state)}
      </p>
    );
  if (update.blocked)
    return (
      <p className="mt-4 text-sm text-muted">
        {t(`updates.blocked.${update.blocked}`)}
      </p>
    );
  return null;
}

function Footer({
  state,
  update,
  onDownload,
  onCancel,
  onRestart,
  onClose,
}: {
  state: UpdateState;
  update: AvailableUpdate;
  onDownload: () => void;
  onCancel: () => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pageLink = (
    <a
      href={update.pageUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-ezl px-4 py-2 text-sm font-medium text-accent hover:underline"
    >
      {t("updates.openPage")}
    </a>
  );
  switch (state.status) {
    case "downloading":
      return <Button onClick={onCancel}>{t("updates.cancel")}</Button>;
    case "ready":
      return (
        <>
          <Button onClick={onClose}>{t("updates.installOnClose")}</Button>
          <Button variant="primary" onClick={onRestart}>
            {t("updates.restartNow")}
          </Button>
        </>
      );
    case "installing":
      return null;
    case "error":
      return (
        <>
          {pageLink}
          <Button variant="primary" onClick={onDownload}>
            {t("updates.tryAgain")}
          </Button>
        </>
      );
    default:
      if (update.blocked)
        return (
          <>
            <Button onClick={onClose}>{t("updates.close")}</Button>
            {pageLink}
          </>
        );
      return (
        <>
          <Button onClick={onClose}>{t("updates.later")}</Button>
          <Button variant="primary" onClick={onDownload}>
            {update.size
              ? t("updates.updateSize", { size: formatSize(t, update.size) })
              : t("updates.update")}
          </Button>
        </>
      );
  }
}
