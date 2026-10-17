import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/relativeTime";
import { stateUpdate, updateKeys, useUpdateState } from "../../state/updates";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { UpdateDialog } from "../updates/UpdateDialog";

/** Settings → About: check for updates now, and the daily check. */
export function UpdateSettings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: state } = useUpdateState();
  const [open, setOpen] = useState(false);
  const prefs = useQuery({
    queryKey: updateKeys.prefs,
    queryFn: () => invoke("updates:getPrefs"),
  });
  const setPrefs = useMutation({
    mutationFn: (autoCheck: boolean) =>
      invoke("updates:setPrefs", { autoCheck }),
    onSuccess: (next) => {
      queryClient.setQueryData(updateKeys.prefs, next);
    },
  });
  const check = useMutation({
    mutationFn: () => invoke("updates:check"),
    onSuccess: (next) => {
      queryClient.setQueryData(updateKeys.state, next);
    },
  });

  const update = stateUpdate(state);
  const when = (iso: string) => relativeTime(i18n.language, iso);
  let status: string | undefined;
  if (state?.status === "checking") status = t("settings.updates.checking");
  else if (state?.status === "upToDate")
    status = t("settings.updates.upToDate", { time: when(state.checkedAt) });
  else if (update)
    status = t("settings.updates.available", { version: update.version });
  else if (state?.status === "error")
    status = t("settings.updates.failed", { error: errorMessage(t, state) });
  else if (state?.checkedAt)
    status = t("settings.updates.lastChecked", { time: when(state.checkedAt) });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            check.mutate();
          }}
          disabled={state?.status === "checking" || check.isPending}
        >
          {t("settings.updates.check")}
        </Button>
        {update && (
          <Button
            variant="primary"
            onClick={() => {
              setOpen(true);
            }}
          >
            {t("settings.updates.view")}
          </Button>
        )}
        {status && (
          <span
            role="status"
            className={`text-sm ${state?.status === "error" && !update ? "text-danger" : "text-muted"}`}
          >
            {status}
          </span>
        )}
      </div>
      <Checkbox
        checked={prefs.data?.autoCheck ?? true}
        disabled={!prefs.data}
        onChange={(checked) => {
          setPrefs.mutate(checked);
        }}
      >
        {t("settings.updates.auto")}
      </Checkbox>
      <UpdateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
