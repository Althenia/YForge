import { useInfiniteQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { pageOptions } from "./diagnosticsModel";

export function createPagedList<T extends { id: number }>(source: () => { key: readonly unknown[]; fetchPage: (before: number | null, limit: number) => Promise<T[]>; enabled?: boolean }) {
  const query = useInfiniteQuery(() => {
    const { key, fetchPage, enabled } = source();
    return { ...pageOptions<T>(key, fetchPage), enabled: enabled ?? true };
  });
  const rows = createMemo((): T[] => (query.status === "pending" ? [] : (query.data?.pages.flat() ?? [])));
  return {
    rows,
    loaded: () => query.status === "success",
    failure: () => (query.error == null ? undefined : query.error instanceof Error ? query.error.message : String(query.error)),
    hasMore: () => query.hasNextPage,
    fetchingMore: () => query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}

export type PagedList<T> = ReturnType<typeof createPagedList<T & { id: number }>>;
