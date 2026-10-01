import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Sparkles, TriangleAlert, X } from "lucide-react";
import type {
  PackDownloadProgress,
  ProfileInfo,
  RemotePack,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { SourceBadge } from "../mods/SourceBadge";
import { RemoteSearchDialog } from "../remote/RemoteSearchDialog";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";

/**
 * Search Modrinth for shaders and download them into the library. From a profile,
 * results fit its Minecraft version and a download becomes its shader. Every
 * shader is listed; ones not tagged for Iris say they may not work.
 */
export function FindShadersDialog({
  profile,
  onGetIris,
  onClose,
}: {
  profile?: ProfileInfo;
  /** Open the mod download for Iris (from a profile without it). */
  onGetIris?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  return (
    <RemoteSearchDialog<RemotePack>
      queryKey={["shaders", "search", profile?.id ?? ""]}
      search={(q, offset) =>
        invoke("shaders:search", {
          query: q,
          offset,
          ...(profile && { profileId: profile.id }),
        })
      }
      hitKey={(hit) => `${hit.sourceId}:${hit.projectId}`}
      renderHit={(hit) => (
        <RemoteShaderRow
          hit={hit}
          profile={profile}
          {...(onGetIris && { onGetIris })}
        />
      )}
      query={query}
      onQueryChange={setQuery}
      title={t("shaders.find.title")}
      searchLabel={t("shaders.find.search")}
      hint={
        profile
          ? t("shaders.find.forVersion", { version: profile.gameVersion })
          : t("shaders.find.anyVersion")
      }
      emptyLabel={t("shaders.find.noResults")}
      loadMoreLabel={t("shaders.find.loadMore")}
      closeLabel={t("shaders.cancel")}
      onClose={onClose}
    />
  );
}

function RemoteShaderRow({
  hit,
  profile,
  onGetIris,
}: {
  hit: RemotePack;
  profile: ProfileInfo | undefined;
  onGetIris?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PackDownloadProgress>();
  useIpcEvent("shaders:download", (p) => {
    if (p.projectId === hit.projectId) setProgress(p);
  });
  const install = useMutation({
    mutationFn: () =>
      invoke("shaders:install", {
        sourceId: hit.sourceId,
        projectId: hit.projectId,
        ...(profile && { profileId: profile.id }),
      }),
    onMutate: () => {
      setProgress(undefined);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["shaders"] });
    },
  });
  const cancelled =
    install.error !== null &&
    (install.error as { code?: string }).code === "CANCELLED";
  const percent =
    progress && progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : undefined;
  const result = install.data;
  const notIris = hit.loaders !== undefined && !hit.loaders.includes("iris");

  return (
    <article className="flex flex-col gap-2 rounded-ezl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface">
          {hit.iconUrl ? (
            <img src={hit.iconUrl} alt="" className="size-10" />
          ) : (
            <Sparkles size={18} className="text-muted" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{hit.name}</span>
            <SourceBadge
              sourceId={hit.sourceId}
              pageUrl={hit.pageUrl}
              modName={hit.name}
            />
            {notIris && (
              <span
                className="text-xs text-warning"
                title={t("shaders.notIrisHint")}
              >
                {t("shaders.notIris")}
              </span>
            )}
          </span>
          <span className="text-xs text-muted">
            {[
              hit.author && t("remote.by", { author: hit.author }),
              hit.downloads !== undefined &&
                t("remote.downloads", {
                  formatted: new Intl.NumberFormat(i18n.language, {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(hit.downloads),
                }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {hit.description && (
            <span className="line-clamp-2 text-sm">{hit.description}</span>
          )}
        </div>
        {install.isPending ? (
          <Button
            variant="ghost"
            className="h-8 px-2"
            aria-label={t("shaders.find.cancel")}
            onClick={() => {
              void invoke("shaders:cancelInstall", hit.projectId);
            }}
          >
            <X size={16} aria-hidden />
          </Button>
        ) : (
          !result && (
            <Button
              variant="primary"
              className="h-8 px-3"
              aria-label={t("shaders.find.downloadLabel", { name: hit.name })}
              onClick={() => {
                install.mutate();
              }}
            >
              <Download size={16} aria-hidden />
              {t("shaders.find.download")}
            </Button>
          )
        )}
      </div>
      {install.isPending && (
        <Progress
          label={t("shaders.find.downloading")}
          {...(percent !== undefined && { value: percent })}
        />
      )}
      {install.isError && !cancelled && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, install.error)}
        </p>
      )}
      {result && (
        <div className="flex flex-col gap-1 text-sm" aria-live="polite">
          <p className="text-success">
            {t("shaders.find.added", {
              name: result.name,
              version: result.versionNumber,
            })}
            {result.activated && ` ${t("shaders.find.activated")}`}
          </p>
          {result.otherVersion && (
            <p className="flex items-center gap-2 text-warning">
              <TriangleAlert size={16} aria-hidden />
              {t("shaders.find.otherVersion")}
            </p>
          )}
          {!result.irisTagged && (
            <p className="text-warning">{t("shaders.notIrisHint")}</p>
          )}
          {result.irisMissing && (
            <p className="flex flex-wrap items-center gap-2 text-warning">
              {t("shaders.find.irisMissing")}
              {onGetIris && (
                <Button
                  variant="secondary"
                  className="h-7 px-2 text-xs"
                  onClick={onGetIris}
                >
                  {t("shaders.iris.install")}
                </Button>
              )}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
