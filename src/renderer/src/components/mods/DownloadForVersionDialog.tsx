import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ModBulkProgress } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { useLoaders, useSettings, useVersionList } from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Progress } from "../ui/Progress";
import { Select } from "../ui/Select";
import { VersionList } from "../versions/VersionList";
import { VersionRefresh } from "../versions/VersionRefresh";
import { visibleTypes } from "../versions/versionTypes";

/**
 * Download the compatible version of every sourced library mod for a chosen
 * version + loader, straight into the library.
 */
export function DownloadForVersionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const versions = useVersionList();
  const loaders = useLoaders();
  const settings = useSettings();

  const [loaderId, setLoaderId] = useState<string | null>(null);
  const [gameVersion, setGameVersion] = useState<string | undefined>();
  const [progress, setProgress] = useState<ModBulkProgress | null>(null);

  const list = useMemo(() => versions.data?.versions ?? [], [versions.data]);
  const loaderOptions = loaders.data ?? [];
  const chosenLoader = loaderId ?? loaderOptions[0]?.id ?? null;

  useIpcEvent("mods:bulkProgress", (p) => {
    setProgress(p);
  });

  const download = useMutation({
    mutationFn: (args: { gameVersion: string; loaderId: string }) =>
      invoke("mods:downloadForVersion", args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });

  const close = () => {
    if (download.isPending) return;
    download.reset();
    setProgress(null);
    onOpenChange(false);
  };

  const percent =
    progress && progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t("mods.bulk.title")}
      closeLabel={t("mods.cancel")}
      footer={
        download.isSuccess ? (
          <Button variant="primary" onClick={close}>
            {t("mods.bulk.close")}
          </Button>
        ) : download.isPending ? (
          <Button
            variant="danger"
            onClick={() => {
              void invoke("mods:cancelBulk");
            }}
          >
            {t("mods.bulk.cancel")}
          </Button>
        ) : (
          <>
            <Button onClick={close}>{t("mods.cancel")}</Button>
            <Button
              variant="primary"
              disabled={!chosenLoader || gameVersion === undefined}
              onClick={() => {
                if (chosenLoader && gameVersion !== undefined) {
                  setProgress(null);
                  download.mutate({ gameVersion, loaderId: chosenLoader });
                }
              }}
            >
              {t("mods.bulk.download")}
            </Button>
          </>
        )
      }
    >
      {download.isSuccess ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>{t("mods.bulk.done", { count: download.data.downloaded })}</p>
          {download.data.skipped.length > 0 && (
            <p className="text-muted">
              {t("mods.bulk.skipped", {
                count: download.data.skipped.length,
                names: download.data.skipped.map((s) => s.name).join(", "),
              })}
            </p>
          )}
        </div>
      ) : download.isPending ? (
        <div className="flex flex-col gap-2">
          <Progress value={percent} label={t("mods.bulk.working")} />
          <p className="text-sm text-muted">{t("mods.bulk.working")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("mods.bulk.body")}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("profiles.editor.loader")}</span>
            <Select
              aria-label={t("profiles.editor.loader")}
              value={chosenLoader ?? ""}
              className="w-56"
              onChange={setLoaderId}
              options={loaderOptions.map((l) => ({
                value: l.id,
                label: l.displayName,
              }))}
            />
          </label>
          <div className="flex h-64 min-h-0 flex-col">
            <VersionList
              toolbar={<VersionRefresh />}
              versions={list}
              types={visibleTypes(settings.data)}
              selectedId={gameVersion}
              onSelect={setGameVersion}
            />
          </div>
          {download.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, download.error)}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
