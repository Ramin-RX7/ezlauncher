import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import type { ProfileInfo, RemotePack } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { usePagedSearch } from "../remote/usePagedSearch";
import { Button } from "../ui/Button";
import { RemoteModCard } from "./RemoteModCard";
import { SourceBadge } from "./SourceBadge";

/**
 * Mods on the site for the profile's version and loader, a page at a time. A
 * result shows what Download would do once opened; the one named exactly like
 * the query opens by itself.
 */
export function ModSearchResults({
  profile,
  query,
}: {
  profile: ProfileInfo;
  query: string;
}) {
  const { t } = useTranslation();
  const { results, hits, debounced } = usePagedSearch(
    ["mods", "search", profile.id],
    (text, offset) =>
      invoke("mods:search", { profileId: profile.id, query: text, offset }),
    query,
  );
  const wanted = debounced.toLowerCase();
  const exact = wanted
    ? hits.find(
        (h) =>
          h.name.toLowerCase() === wanted || h.slug.toLowerCase() === wanted,
      )
    : undefined;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted">
        {t("remote.siteHeading")}
      </h3>
      {results.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, results.error)}
        </p>
      )}
      {results.isPending && (
        <p className="text-sm text-muted">{t("remote.searching")}</p>
      )}
      {results.isSuccess && hits.length === 0 && (
        <p className="text-sm text-muted" aria-live="polite">
          {t("remote.notFound")}
        </p>
      )}
      {hits.map((hit) => (
        <RemoteModRow
          key={`${hit.sourceId}:${hit.projectId}`}
          hit={hit}
          profile={profile}
          autoOpen={hit === exact}
        />
      ))}
      {results.hasNextPage && (
        <Button
          variant="ghost"
          disabled={results.isFetchingNextPage}
          onClick={() => {
            void results.fetchNextPage();
          }}
        >
          {t("remote.loadMore")}
        </Button>
      )}
    </section>
  );
}

/** One search result; opening it asks the launcher what Download would fetch. */
function RemoteModRow({
  hit,
  profile,
  autoOpen,
}: {
  hit: RemotePack;
  profile: ProfileInfo;
  autoOpen: boolean;
}) {
  const { t, i18n } = useTranslation();
  const prepare = useMutation({
    mutationFn: () =>
      invoke("mods:prepare", {
        profileId: profile.id,
        sourceId: hit.sourceId,
        projectId: hit.projectId,
      }),
  });
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    prepare.mutate();
  }, [autoOpen, prepare]);

  const card = prepare.data;
  if (card)
    return (
      <RemoteModCard
        // The site's project lookup has no author; the search result does.
        card={{
          ...card,
          project: {
            ...card.project,
            author: card.project.author || hit.author,
          },
        }}
        gameVersion={profile.gameVersion}
      />
    );

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
        <Button
          variant="secondary"
          className="h-8 px-3"
          disabled={prepare.isPending}
          aria-label={t("remote.open", { name: hit.name })}
          onClick={() => {
            prepare.mutate();
          }}
        >
          {prepare.isPending ? t("remote.opening") : t("remote.get")}
        </Button>
      </div>
      {prepare.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, prepare.error)}
        </p>
      )}
    </article>
  );
}
