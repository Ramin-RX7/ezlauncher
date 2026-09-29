import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderInput, FolderPlus } from "lucide-react";
import type { MoveProgress } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Progress } from "../ui/Progress";

const MB = 1024 * 1024;

/**
 * Data folder → Change: pick a folder, then Move my data there (with a progress
 * screen) or Start empty there. Either way the launcher restarts on the new folder.
 */
export function DataDirChange({ current }: { current: string | undefined }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string>();
  const [progress, setProgress] = useState<MoveProgress>();
  useIpcEvent("setup:moveProgress", setProgress);

  const choose = useMutation({
    mutationFn: () => invoke("setup:chooseFolder"),
    onSuccess: (dir) => {
      if (dir && dir !== current) setTarget(dir);
    },
  });
  const move = useMutation({
    mutationFn: (dir: string) => invoke("setup:moveDataDir", dir), // restarts when done
    onMutate: () => {
      setProgress(undefined);
    },
  });
  const startEmpty = useMutation({
    mutationFn: (dir: string) => invoke("setup:setDataDir", dir), // restarts
  });
  const cancelled =
    move.error !== null &&
    (move.error as { code?: string }).code === "CANCELLED";

  if (move.isPending) {
    const p = progress;
    const percent =
      p && p.totalBytes > 0 ? (p.bytes / p.totalBytes) * 100 : undefined;
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="moving-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-bg"
      >
        <div className="flex w-[min(90vw,28rem)] flex-col gap-3">
          <h2 id="moving-title" className="text-lg font-semibold">
            {t("settings.dataDir.moving")}
          </h2>
          <p className="text-sm text-muted">
            {p
              ? t(`settings.dataDir.movingSteps.${p.step}`)
              : t("settings.dataDir.movingSteps.counting")}
            {p && p.totalFiles > 0 && (
              <>
                {" · "}
                {t("settings.dataDir.progress", {
                  files: p.files,
                  totalFiles: p.totalFiles,
                  mb: (p.bytes / MB).toFixed(0),
                  totalMb: (p.totalBytes / MB).toFixed(0),
                })}
              </>
            )}
          </p>
          <Progress value={percent} label={t("settings.dataDir.moving")} />
          <p className="text-xs text-muted">{t("settings.dataDir.keepOpen")}</p>
          <Button
            className="self-end"
            disabled={p?.step === "cleaning"}
            onClick={() => {
              void invoke("setup:cancelMove");
            }}
          >
            {t("settings.dataDir.cancelMove")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button
        disabled={choose.isPending}
        onClick={() => {
          move.reset();
          choose.mutate();
        }}
      >
        {t("settings.dataDir.change")}
      </Button>
      {move.isError && !cancelled && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, move.error)}
        </p>
      )}
      {target && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setTarget(undefined);
          }}
          title={t("settings.dataDir.dialogTitle")}
          description={t("settings.dataDir.dialogBody", { dir: target })}
          closeLabel={t("settings.dataDir.cancel")}
          footer={
            <Button
              onClick={() => {
                setTarget(undefined);
              }}
            >
              {t("settings.dataDir.cancel")}
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                move.mutate(target);
                setTarget(undefined);
              }}
              className="flex items-start gap-3 rounded-ezl border border-border p-3 text-start hover:border-accent"
            >
              <FolderInput
                size={20}
                className="mt-0.5 text-accent"
                aria-hidden
              />
              <span className="flex flex-col">
                <span className="font-medium">
                  {t("settings.dataDir.move")}
                </span>
                <span className="text-xs text-muted">
                  {t("settings.dataDir.moveHint")}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={startEmpty.isPending}
              onClick={() => {
                startEmpty.mutate(target);
              }}
              className="flex items-start gap-3 rounded-ezl border border-border p-3 text-start hover:border-accent"
            >
              <FolderPlus size={20} className="mt-0.5 text-muted" aria-hidden />
              <span className="flex flex-col">
                <span className="font-medium">
                  {t("settings.dataDir.empty")}
                </span>
                <span className="text-xs text-muted">
                  {t("settings.dataDir.emptyHint")}
                </span>
              </span>
            </button>
            {startEmpty.isError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(t, startEmpty.error)}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
