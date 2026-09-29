import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { InstallProgress } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";

const MB = 1024 * 1024;

/** An install or repair in progress: its step, files and bytes, and Cancel. */
export function InstallProgressRow({
  versionId,
  progress: p,
}: {
  versionId: string;
  progress: InstallProgress | undefined;
}) {
  const { t } = useTranslation();
  const percent =
    p && p.totalBytes > 0
      ? (p.bytes / p.totalBytes) * 100
      : p && p.totalFiles > 0
        ? (p.files / p.totalFiles) * 100
        : undefined;
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex justify-between gap-2 text-xs text-muted">
          <span>{p ? t(`play.steps.${p.step}`) : t("play.installing")}</span>
          {p && p.totalFiles > 0 && (
            <span>
              {t("play.progress", {
                files: p.files,
                totalFiles: p.totalFiles,
                mb: (p.bytes / MB).toFixed(1),
                totalMb: (p.totalBytes / MB).toFixed(1),
              })}
            </span>
          )}
        </div>
        <Progress value={percent} label={t("play.installing")} />
      </div>
      <Button
        variant="ghost"
        aria-label={t("play.cancel")}
        onClick={() => {
          void invoke("versions:cancel", versionId);
        }}
      >
        <X size={16} aria-hidden />
        {t("play.cancel")}
      </Button>
    </div>
  );
}
