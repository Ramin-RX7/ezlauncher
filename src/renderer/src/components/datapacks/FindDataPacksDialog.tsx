import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Package, TriangleAlert, X } from "lucide-react";
import type {
  PackDownloadProgress,
  ProfileInfo,
  RemotePack,
  WorldInfo,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { AddModDialog } from "../mods/AddModDialog";
import { SourceBadge } from "../mods/SourceBadge";
import { RemoteSearchDialog } from "../remote/RemoteSearchDialog";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";

/**
 * Search Modrinth for data packs (projects with a data pack version) and download
 * them into the library. From a world, results fit its profile's Minecraft version
 * and a download goes into the world.
 */
export function FindDataPacksDialog({
  world,
  profile,
  onClose,
}: {
  world?: WorldInfo;
  /** The world's profile (for its version, and to get mods a pack needs). */
  profile?: ProfileInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [modQuery, setModQuery] = useState<string>();

  if (modQuery !== undefined && profile)
    return (
      <AddModDialog
        profile={profile}
        initialQuery={modQuery}
        autoSearch
        onClose={() => {
          setModQuery(undefined);
        }}
      />
    );

  return (
    <RemoteSearchDialog<RemotePack>
      queryKey={["dataPacks", "search", world?.id ?? ""]}
      search={(q, offset) =>
        invoke("dataPacks:search", {
          query: q,
          offset,
          ...(world && { worldId: world.id }),
        })
      }
      hitKey={(hit) => `${hit.sourceId}:${hit.projectId}`}
      renderHit={(hit) => (
        <RemoteDataPackRow
          hit={hit}
          world={world}
          canGetMods={profile?.loader != null}
          onGetMod={setModQuery}
        />
      )}
      query={query}
      onQueryChange={setQuery}
      title={t("dataPacks.find.title")}
      searchLabel={t("dataPacks.find.search")}
      hint={
        profile
          ? t("dataPacks.find.forVersion", { version: profile.gameVersion })
          : t("dataPacks.find.anyVersion")
      }
      emptyLabel={t("dataPacks.find.noResults")}
      loadMoreLabel={t("dataPacks.find.loadMore")}
      closeLabel={t("dataPacks.cancel")}
      onClose={onClose}
    />
  );
}

function RemoteDataPackRow({
  hit,
  world,
  canGetMods,
  onGetMod,
}: {
  hit: RemotePack;
  world: WorldInfo | undefined;
  canGetMods: boolean;
  onGetMod: (slug: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PackDownloadProgress>();
  useIpcEvent("dataPacks:download", (p) => {
    if (p.projectId === hit.projectId) setProgress(p);
  });
  const install = useMutation({
    mutationFn: () =>
      invoke("dataPacks:install", {
        sourceId: hit.sourceId,
        projectId: hit.projectId,
        ...(world && { worldId: world.id }),
      }),
    onMutate: () => {
      setProgress(undefined);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["dataPacks"] });
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

  return (
    <article className="flex flex-col gap-2 rounded-ezl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface">
          {hit.iconUrl ? (
            <img src={hit.iconUrl} alt="" className="size-10" />
          ) : (
            <Package size={18} className="text-muted" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{hit.name}</span>
            <SourceBadge
              sourceId={hit.sourceId}
              pageUrl={hit.pageUrl}
              modName={hit.name}
            />
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
            aria-label={t("dataPacks.find.cancel")}
            onClick={() => {
              void invoke("dataPacks:cancelInstall", hit.projectId);
            }}
          >
            <X size={16} aria-hidden />
          </Button>
        ) : (
          !result && (
            <Button
              variant="primary"
              className="h-8 px-3"
              aria-label={t("dataPacks.find.downloadLabel", { name: hit.name })}
              onClick={() => {
                install.mutate();
              }}
            >
              <Download size={16} aria-hidden />
              {t("dataPacks.find.download")}
            </Button>
          )
        )}
      </div>
      {install.isPending && (
        <Progress
          label={t("dataPacks.find.downloading")}
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
            {t("dataPacks.find.added", {
              name: result.name,
              version: result.versionNumber,
            })}
            {result.added && ` ${t("dataPacks.find.inWorld")}`}
          </p>
          {result.otherVersion && (
            <p className="flex items-center gap-2 text-warning">
              <TriangleAlert size={16} aria-hidden />
              {t("dataPacks.find.otherVersion")}
            </p>
          )}
          {result.compat !== "compatible" && result.compat !== "unknown" && (
            <p className="text-warning">
              {t(`resourcePacks.compat.${result.compat}`)}
            </p>
          )}
          {result.needs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted">
                {t("dataPacks.find.needs")}
              </span>
              {result.needs.map((need) =>
                need.projectType === "mod" && canGetMods ? (
                  <Button
                    key={need.slug}
                    variant="secondary"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      onGetMod(need.slug);
                    }}
                  >
                    {t("dataPacks.find.getMod", { name: need.name })}
                  </Button>
                ) : (
                  <a
                    key={need.slug}
                    href={need.pageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    {need.name}
                  </a>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
