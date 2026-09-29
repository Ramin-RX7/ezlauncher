import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { JavaInstallProgress, JavaRuntimeInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatSize } from "../../lib/formatSize";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Progress } from "../ui/Progress";

const JAVA_KEY = ["java"] as const;

/** Java runtimes the launcher downloads (install / remove), and Java already on the computer. */
export function JavaSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const java = useQuery({
    queryKey: JAVA_KEY,
    queryFn: () => invoke("java:list"),
  });
  const [progress, setProgress] = useState<JavaInstallProgress | null>(null);
  const [removing, setRemoving] = useState<JavaRuntimeInfo>();

  useIpcEvent("java:progress", setProgress);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: JAVA_KEY });
  };
  const install = useMutation({
    mutationFn: (component: string) => {
      setProgress(null);
      return invoke("java:install", component);
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (component: string) => invoke("java:remove", component),
    onSuccess: () => {
      setRemoving(undefined);
      refresh();
    },
  });

  const runtimes = java.data?.runtimes ?? [];
  const system = java.data?.system ?? [];
  const installing = install.isPending ? install.variables : undefined;
  const percent =
    progress && progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : undefined;
  const title = (r: JavaRuntimeInfo) =>
    r.major !== undefined
      ? t("settings.java.name", { major: r.major })
      : r.component;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">
            {t("settings.java.managed")}
          </span>
          <Button variant="ghost" onClick={refresh} disabled={java.isFetching}>
            {t("settings.java.refresh")}
          </Button>
        </div>
        <p className="text-xs text-muted">{t("settings.java.managedHint")}</p>
        {java.data?.offline && (
          <p className="text-xs text-warning">{t("settings.java.offline")}</p>
        )}
        {java.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, java.error)}
          </p>
        )}
        <ul className="overflow-hidden rounded-ezl border border-border">
          {runtimes.map((r) => (
            <li
              key={r.component}
              className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{title(r)}</span>
                    {r.installed && (
                      <span className="rounded-ezl bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                        {t("settings.java.installed")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {[
                      r.versionName,
                      r.component,
                      r.sizeBytes !== undefined && formatSize(t, r.sizeBytes),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {r.usedBy.length > 0
                      ? t("settings.java.usedBy", {
                          versions: r.usedBy.join(", "),
                        })
                      : t("settings.java.unused")}
                  </span>
                </div>
                {installing === r.component ? (
                  <Button
                    onClick={() => {
                      void invoke("java:cancel");
                    }}
                  >
                    {t("settings.java.cancel")}
                  </Button>
                ) : r.installed ? (
                  <>
                    {r.available && (
                      <Button
                        variant="ghost"
                        disabled={installing !== undefined}
                        onClick={() => {
                          install.mutate(r.component);
                        }}
                      >
                        {t("settings.java.repair")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="text-danger"
                      disabled={installing !== undefined}
                      onClick={() => {
                        remove.reset();
                        setRemoving(r);
                      }}
                    >
                      {t("settings.java.remove")}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={!r.available || installing !== undefined}
                    onClick={() => {
                      install.mutate(r.component);
                    }}
                  >
                    {t("settings.java.install")}
                  </Button>
                )}
              </div>
              {installing === r.component && (
                <Progress
                  value={percent}
                  label={t("settings.java.installing")}
                />
              )}
            </li>
          ))}
          {java.isSuccess && runtimes.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">
              {t("settings.java.none")}
            </li>
          )}
        </ul>
        {install.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, install.error)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("settings.java.system")}</span>
        <p className="text-xs text-muted">{t("settings.java.systemHint")}</p>
        <ul className="overflow-hidden rounded-ezl border border-border">
          {system.map((s) => (
            <li
              key={s.home}
              className="flex flex-col border-b border-border px-3 py-2 last:border-b-0"
            >
              <span className="font-medium">
                {s.major !== undefined
                  ? t("settings.java.name", { major: s.major })
                  : t("settings.java.unknownVersion")}
                {s.vendor && (
                  <span className="ms-2 text-xs font-normal text-muted">
                    {s.vendor}
                  </span>
                )}
              </span>
              <span className="truncate text-xs text-muted" title={s.home}>
                {[s.version, s.home].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
          {java.isSuccess && system.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">
              {t("settings.java.noSystem")}
            </li>
          )}
        </ul>
      </div>

      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined);
          }}
          title={t("settings.java.removeTitle", { name: title(removing) })}
          description={
            removing.usedBy.length > 0
              ? t("settings.java.removeUsed", {
                  versions: removing.usedBy.join(", "),
                })
              : t("settings.java.removeBody")
          }
          closeLabel={t("settings.java.cancel")}
          footer={
            <>
              <Button
                onClick={() => {
                  setRemoving(undefined);
                }}
              >
                {t("settings.java.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(removing.component);
                }}
              >
                {t("settings.java.remove")}
              </Button>
            </>
          }
        >
          {remove.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, remove.error)}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
