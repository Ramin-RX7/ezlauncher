import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ModUpdate, ProfileInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatSize } from "../../lib/formatSize";
import { ReleaseNotes } from "../../lib/releaseNotes";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Progress } from "../ui/Progress";

const modUpdatesKey = (profileId: string) =>
  ["mods", "updates", profileId] as const;

/** Mods tab → Check for updates: newer versions of the enabled mods, picked and updated. */
export function ModUpdatesDialog({
  profile,
  onClose,
}: {
  profile: ProfileInfo;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const check = useQuery({
    queryKey: modUpdatesKey(profile.id),
    queryFn: () => invoke("mods:checkUpdates", profile.id),
    // Ask the sites each time the dialog opens.
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
  });
  /** Ticks the user changed; the rest follow the default. */
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ bytes: number; total: number }>();
  useIpcEvent("mods:bulkProgress", (p) => {
    setProgress({ bytes: p.bytes, total: p.totalBytes });
  });

  // Everything is ticked at first, except mods a mod pack updates itself.
  const updates = check.data?.updates;
  const isPicked = (u: ModUpdate) => choice[u.sha1] ?? !u.fromPack;

  const apply = useMutation({
    mutationFn: (sha1s: string[]) =>
      invoke("mods:applyUpdates", { profileId: profile.id, sha1s }),
    onSettled: () => {
      setProgress(undefined);
      void queryClient.invalidateQueries({ queryKey: ["mods", "library"] });
      void queryClient.invalidateQueries({ queryKey: ["mods", "validate"] });
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: modUpdatesKey(profile.id) });
    },
  });

  const running = profile.running > 0;
  const chosen = (updates ?? []).filter(isPicked);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
  });
  const toggle = (u: ModUpdate, on: boolean) => {
    setChoice((old) => ({ ...old, [u.sha1]: on }));
  };

  let body;
  if (apply.isSuccess) {
    const { updated, failed } = apply.data;
    body = (
      <div className="flex flex-col gap-2 text-sm">
        <p role="status">{t("mods.updates.done", { count: updated.length })}</p>
        {updated.length > 0 && (
          <ul className="list-disc ps-5 text-muted">
            {updated.map((u) => (
              <li key={u.name}>
                {t("mods.updates.fromTo", {
                  name: u.name,
                  from: u.from ?? "?",
                  to: u.to,
                })}
              </li>
            ))}
          </ul>
        )}
        {failed.map((f) => (
          <p key={f.name} role="alert" className="text-danger">
            {t("mods.updates.failed", {
              name: f.name,
              error: errorMessage(t, f),
            })}
          </p>
        ))}
        <p className="text-muted">{t("mods.updates.goBack")}</p>
      </div>
    );
  } else if (apply.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        <Progress
          label={t("mods.updates.working")}
          {...(progress?.total && {
            value: (progress.bytes / progress.total) * 100,
          })}
        />
        <p className="text-sm text-muted">{t("mods.updates.working")}</p>
      </div>
    );
  } else if (check.isPending) {
    body = <p className="text-sm text-muted">{t("mods.updates.checking")}</p>;
  } else if (check.isError) {
    body = (
      <p role="alert" className="text-sm text-danger">
        {errorMessage(t, check.error)}
      </p>
    );
  } else {
    const data = check.data;
    body = (
      <div className="flex flex-col gap-3">
        {data.updates.length === 0 ? (
          <p role="status" className="text-sm">
            {t("mods.updates.none")}
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-auto pe-2">
            {data.updates.map((u) => (
              <li
                key={u.sha1}
                className="flex flex-col gap-1 rounded-ezl border border-border p-3"
              >
                <Checkbox
                  checked={isPicked(u)}
                  onChange={(on) => {
                    toggle(u, on);
                  }}
                >
                  <span className="font-medium">{u.name}</span>{" "}
                  <span className="text-muted">
                    {t("mods.updates.versions", {
                      from: u.fromVersion ?? "?",
                      to: u.toVersion,
                    })}
                  </span>
                  {u.channel !== "release" && (
                    <span className="ms-2 rounded-ezl border border-warning px-1.5 text-xs text-warning">
                      {t(`mods.updates.channel.${u.channel}`)}
                    </span>
                  )}
                </Checkbox>
                <p className="ps-6 text-xs text-muted">
                  {[
                    u.published && dateFormat.format(new Date(u.published)),
                    formatSize(t, u.size),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {" · "}
                  <a
                    href={u.pageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {t("mods.updates.page")}
                  </a>
                </p>
                {u.fromPack && (
                  <p className="ps-6 text-xs text-warning">
                    {t("mods.updates.fromPack")}
                  </p>
                )}
                {u.changelog && (
                  <details className="ps-6 text-sm">
                    <summary className="cursor-pointer text-muted hover:text-text">
                      {t("mods.updates.changelog")}
                    </summary>
                    <div className="mt-2 max-h-48 overflow-auto">
                      <ReleaseNotes markdown={u.changelog} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.unknown.length > 0 && (
          <p className="text-xs text-muted">
            {t("mods.updates.unknown", {
              count: data.unknown.length,
              names: data.unknown.map((u) => u.name).join(", "),
            })}
          </p>
        )}
        {running && (
          <p className="text-sm text-muted">{t("worlds.runningBlocked")}</p>
        )}
        {apply.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, apply.error)}
          </p>
        )}
      </div>
    );
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open && !apply.isPending) onClose();
      }}
      title={t("mods.updates.title", { name: profile.name })}
      closeLabel={t("mods.updates.close")}
      footer={
        apply.isPending ? (
          <Button
            variant="danger"
            onClick={() => {
              void invoke("mods:cancelBulk");
            }}
          >
            {t("mods.updates.cancel")}
          </Button>
        ) : apply.isSuccess || !updates?.length ? (
          <Button onClick={onClose}>{t("mods.updates.close")}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t("mods.updates.close")}</Button>
            <Button
              variant="primary"
              disabled={chosen.length === 0 || running}
              onClick={() => {
                apply.mutate(chosen.map((u) => u.sha1));
              }}
            >
              {t("mods.updates.update", { count: chosen.length })}
            </Button>
          </>
        )
      }
    >
      {body}
    </Dialog>
  );
}
