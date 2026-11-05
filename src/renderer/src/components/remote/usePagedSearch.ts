import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

/** The page size every site search uses (the main process asks for 20). */
export const PAGE = 20;

/**
 * A site search a page at a time: typing waits a moment before searching, and
 * `fetchNextPage` loads the next 20 while there are more.
 */
export function usePagedSearch<T>(
  queryKey: readonly unknown[],
  search: (
    query: string,
    offset: number,
  ) => Promise<{ hits: T[]; total: number }>,
  query: string,
) {
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const results = useInfiniteQuery({
    queryKey: [...queryKey, debounced],
    queryFn: ({ pageParam }) => search(debounced, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.hits.length, 0);
      return loaded < last.total && last.hits.length === PAGE
        ? loaded
        : undefined;
    },
    staleTime: 60_000,
  });
  const hits = results.data?.pages.flatMap((p) => p.hits) ?? [];
  return { results, hits, debounced };
}
