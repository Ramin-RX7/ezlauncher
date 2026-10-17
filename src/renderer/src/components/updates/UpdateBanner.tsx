import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine } from "lucide-react";
import type { UpdateState } from "@shared/updates";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { stateUpdate, useUpdateState } from "../../state/updates";
import { Button } from "../ui/Button";
import { UpdateDialog } from "./UpdateDialog";

/** Hidden with "Later" until the state or the version changes (or the app restarts). */
function bannerKey(state: UpdateState | undefined): string | undefined {
  if (!state) return undefined;
  const update = stateUpdate(state);
  if (state.status === "error")
    return update || state.code === "UPDATE_INCOMPLETE"
      ? `error:${state.code}:${update?.version ?? ""}`
      : undefined;
  if (!update) return undefined;
  // Download progress isn't a new state for the banner.
  return `${state.status === "downloading" ? "available" : state.status}:${update.version}`;
}

/** A line under the top bar when a launcher update is available or ready. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { data: state } = useUpdateState();
  const [dismissed, setDismissed] = useState<string>();
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<unknown>();
  const key = bannerKey(state);
  const update = stateUpdate(state);
  if (!state || !key || key === dismissed) return null;

  let text: string;
  let action: { label: string; run: () => void } | undefined;
  const openDialog = {
    label: t("updates.whatsNew"),
    run: () => {
      setOpen(true);
    },
  };
  switch (state.status) {
    case "available":
      text = t("updates.banner.available", { version: state.update.version });
      action =
        state.update.blocked === undefined
          ? {
              label: t("updates.update"),
              run: () => {
                setOpen(true);
                void invoke("updates:download").catch(() => undefined);
              },
            }
          : undefined;
      break;
    case "downloading":
      text = t("updates.banner.downloading", {
        version: state.update.version,
        percent: state.total
          ? Math.floor((state.received / state.total) * 100)
          : 0,
      });
      break;
    case "ready":
      text = t("updates.banner.ready", { version: state.update.version });
      action = {
        label: t("updates.restartNow"),
        run: () => {
          setActionError(undefined);
          // Refused while the launcher is busy: say so here; the state stays ready.
          void invoke("updates:install", { restart: true }).catch(
            (err: unknown) => {
              setActionError(err);
            },
          );
        },
      };
      break;
    case "installing":
      text = t("updates.banner.installing", { version: state.update.version });
      break;
    case "error":
      text = update
        ? t("updates.banner.failed", {
            version: update.version,
            error: errorMessage(t, state),
          })
        : t("updates.banner.incomplete");
      break;
    default:
      return null;
  }

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface-2 px-6 py-2 text-sm"
    >
      <ArrowDownToLine size={16} aria-hidden className="text-accent" />
      <span className="min-w-0 flex-1">
        {text}
        {actionError !== undefined && state.status === "ready" && (
          <span className="ms-2 text-danger">
            {errorMessage(t, actionError)}
          </span>
        )}
      </span>
      {update && (
        <Button variant="ghost" className="py-1" onClick={openDialog.run}>
          {openDialog.label}
        </Button>
      )}
      {action && (
        <Button variant="primary" className="py-1" onClick={action.run}>
          {action.label}
        </Button>
      )}
      {state.status !== "installing" && (
        <Button
          variant="ghost"
          className="py-1"
          onClick={() => {
            setDismissed(key);
          }}
        >
          {state.status === "error" ? t("updates.dismiss") : t("updates.later")}
        </Button>
      )}
      <UpdateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
