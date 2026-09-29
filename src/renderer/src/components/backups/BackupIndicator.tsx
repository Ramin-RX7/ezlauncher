import { useTranslation } from "react-i18next";
import { Archive } from "lucide-react";
import { invoke } from "../../lib/api";
import { useLauncherState } from "../../state/launcherStore";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";

/**
 * The backup in progress, in the top bar: visible on every page, since automatic
 * backups can run after a game closes while the user is elsewhere.
 */
export function BackupIndicator() {
  const { t } = useTranslation();
  const backup = useLauncherState((s) => s.backup);
  if (!backup) return null;
  const p = backup.progress;
  const percent =
    p && p.totalBytes > 0 ? (p.bytes / p.totalBytes) * 100 : undefined;
  return (
    <div role="status" className="flex items-center gap-2 text-xs">
      <Archive size={16} className="shrink-0 text-muted" aria-hidden />
      <div className="flex w-48 flex-col gap-1">
        <span className="truncate">
          {p
            ? t("backups.indicator", {
                name: p.worldName,
                index: p.index,
                total: p.total,
              })
            : t("backups.indicatorStarting")}
        </span>
        <Progress value={percent} label={t("backups.progressLabel")} />
      </div>
      <Button
        variant="ghost"
        onClick={() => {
          void invoke("backups:cancel");
        }}
      >
        {/* Before the start, cancelling only skips the backup: the game still starts. */}
        {backup.beforeStart ? t("backups.skip") : t("backups.cancel")}
      </Button>
    </div>
  );
}
