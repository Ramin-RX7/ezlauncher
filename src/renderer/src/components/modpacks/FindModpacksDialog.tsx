import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import type { RemotePack } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { SourceBadge } from "../mods/SourceBadge";
import { RemoteSearchDialog } from "../remote/RemoteSearchDialog";
import { Button } from "../ui/Button";
import { isSupportedPack, loaderLabel } from "./modpackText";

/** How many of a pack's newest Minecraft versions a result shows. */
const SHOWN_VERSIONS = 3;

/**
 * Search Modrinth for mod packs. Every pack is listed; those made only for loaders
 * this launcher can't run (Forge, NeoForge) can't be chosen.
 */
export function FindModpacksDialog({
  onChoose,
  onClose,
}: {
  onChoose: (pack: RemotePack) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  return (
    <RemoteSearchDialog<RemotePack>
      queryKey={["modpacks", "search"]}
      search={(q, offset) => invoke("modpacks:search", { query: q, offset })}
      hitKey={(hit) => `${hit.sourceId}:${hit.projectId}`}
      renderHit={(hit) => <PackRow hit={hit} onChoose={onChoose} />}
      query={query}
      onQueryChange={setQuery}
      title={t("modpacks.find.title")}
      searchLabel={t("modpacks.find.search")}
      hint={t("modpacks.find.hint")}
      emptyLabel={t("modpacks.find.noResults")}
      loadMoreLabel={t("modpacks.find.loadMore")}
      closeLabel={t("modpacks.cancel")}
      onClose={onClose}
    />
  );
}

function PackRow({
  hit,
  onChoose,
}: {
  hit: RemotePack;
  onChoose: (pack: RemotePack) => void;
}) {
  const { t, i18n } = useTranslation();
  const supported = isSupportedPack(hit.loaders);
  const versions = hit.gameVersions ?? [];
  return (
    <article className="flex items-start gap-3 rounded-ezl border border-border bg-surface-2 p-3">
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
            versions.length > 0 &&
              versions.slice(-SHOWN_VERSIONS).reverse().join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {hit.description && (
          <span className="line-clamp-2 text-sm">{hit.description}</span>
        )}
        {hit.loaders && hit.loaders.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {hit.loaders.map((l) => (
              <span
                key={l}
                className="rounded-ezl border border-border px-1.5 py-0.5 text-xs text-muted"
              >
                {loaderLabel(t, l)}
              </span>
            ))}
          </span>
        )}
      </div>
      {supported ? (
        <Button
          variant="primary"
          className="h-8 px-3"
          aria-label={t("modpacks.find.chooseLabel", { name: hit.name })}
          onClick={() => {
            onChoose(hit);
          }}
        >
          {t("modpacks.find.choose")}
        </Button>
      ) : (
        <span className="shrink-0 rounded-ezl bg-warning/15 px-2 py-1 text-xs text-warning">
          {t("modpacks.find.unsupported", {
            loader: (hit.loaders ?? [])
              .map((l) => loaderLabel(t, l))
              .join(", "),
          })}
        </span>
      )}
    </article>
  );
}
