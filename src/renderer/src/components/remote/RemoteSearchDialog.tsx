import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { usePagedSearch } from "./usePagedSearch";

/**
 * Search a site and list the results, a page at a time ("Load more"). Typing
 * waits a moment before searching. Each result is drawn by `renderHit`.
 */
export function RemoteSearchDialog<T>({
  queryKey,
  search,
  hitKey,
  renderHit,
  query,
  onQueryChange,
  title,
  searchLabel,
  hint,
  emptyLabel,
  loadMoreLabel,
  closeLabel,
  onClose,
}: {
  /** Identifies the search (the query text is added). */
  queryKey: readonly unknown[];
  search: (
    query: string,
    offset: number,
  ) => Promise<{ hits: T[]; total: number }>;
  hitKey: (hit: T) => string;
  renderHit: (hit: T) => ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  title: string;
  searchLabel: string;
  /** A line under the search box (e.g. which Minecraft version is searched). */
  hint?: string;
  emptyLabel: string;
  loadMoreLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { results, hits } = usePagedSearch(queryKey, search, query);

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      closeLabel={closeLabel}
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute start-2.5 top-2.5 text-muted"
          />
          <Input
            type="search"
            autoFocus
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
            }}
            className="w-full ps-8"
          />
        </div>
        {hint && <p className="text-xs text-muted">{hint}</p>}
        {results.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, results.error)}
          </p>
        )}
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-auto">
          {results.isSuccess && hits.length === 0 && (
            <p className="p-4 text-center text-sm text-muted">{emptyLabel}</p>
          )}
          {hits.map((hit) => (
            <div key={hitKey(hit)}>{renderHit(hit)}</div>
          ))}
          {results.hasNextPage && (
            <Button
              variant="ghost"
              disabled={results.isFetchingNextPage}
              onClick={() => {
                void results.fetchNextPage();
              }}
            >
              {loadMoreLabel}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
