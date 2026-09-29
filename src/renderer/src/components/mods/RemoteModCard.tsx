import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Package, TriangleAlert, X } from "lucide-react";
import type { ModDownloadProgress, RemoteMatchCard } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";
import { SourceBadge } from "./SourceBadge";

const MB = 1024 * 1024;

/** One exact match: what Download will fetch and enable, then the download itself. */
export function RemoteModCard({
  card,
  gameVersion,
}: {
  card: RemoteMatchCard;
  gameVersion: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ModDownloadProgress>();
  useIpcEvent("mods:download", (p) => {
    if (p.planId === card.planId) setProgress(p);
  });

  const download = useMutation({
    mutationFn: (planId: string) => invoke("mods:installRemote", planId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });
  const cancelled =
    download.error !== null &&
    (download.error as { code?: string }).code === "CANCELLED";

  const { project, version } = card;
  const percent =
    progress && progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : undefined;

  return (
    <article className="flex flex-col gap-3 rounded-ezl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface">
          {project.iconUrl ? (
            <img src={project.iconUrl} alt="" className="size-12" />
          ) : (
            <Package size={20} className="text-muted" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{project.name}</span>
            <SourceBadge
              sourceId={card.sourceId}
              pageUrl={project.pageUrl}
              modName={project.name}
            />
          </span>
          {(project.author || project.downloads !== undefined) && (
            <span className="text-xs text-muted">
              {[
                project.author && t("remote.by", { author: project.author }),
                project.downloads !== undefined &&
                  t("remote.downloads", {
                    formatted: new Intl.NumberFormat(i18n.language, {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(project.downloads),
                  }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          <span className="text-sm">
            {version
              ? t("remote.willDownload", { version: version.versionNumber })
              : t("remote.noVersion", { game: gameVersion })}
          </span>
        </div>
      </div>

      {card.dependencies.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">
            {t("remote.dependencies")}
          </span>
          <ul className="list-disc ps-5">
            {card.dependencies.map((d) => (
              <li key={d.name}>
                {d.action === "download"
                  ? t("remote.depDownload", {
                      name: d.name,
                      version: d.versionNumber ?? "",
                    })
                  : t("remote.depReuse", { name: d.name })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {[
        card.missing.length > 0 &&
          t("remote.missing", { names: card.missing.join(", ") }),
        card.incompatible.length > 0 &&
          t("remote.incompatible", { names: card.incompatible.join(", ") }),
        card.replaces.length > 0 &&
          t("remote.replaces", { names: card.replaces.join(", ") }),
      ]
        .filter((w): w is string => typeof w === "string")
        .map((warning) => (
          <p
            key={warning}
            className="flex items-start gap-2 text-sm text-warning"
          >
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}

      {download.isSuccess ? (
        <p className="text-sm text-success" aria-live="polite">
          {t("remote.done", { name: project.name })}
        </p>
      ) : (
        card.planId && (
          <div className="flex items-center gap-3">
            {download.isPending ? (
              <>
                <div className="flex-1">
                  <Progress value={percent} label={t("remote.downloading")} />
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void invoke("mods:cancelRemote", card.planId ?? "");
                  }}
                >
                  <X size={16} aria-hidden />
                  {t("remote.cancel")}
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-xs text-muted">
                  {card.totalSize > 0
                    ? t("remote.size", {
                        mb: (card.totalSize / MB).toFixed(1),
                      })
                    : t("remote.nothingToDownload")}
                </span>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (card.planId) download.mutate(card.planId);
                  }}
                >
                  <Download size={16} aria-hidden />
                  {t("remote.download")}
                </Button>
              </>
            )}
          </div>
        )
      )}
      {download.isError && !cancelled && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, download.error)}
        </p>
      )}
    </article>
  );
}
