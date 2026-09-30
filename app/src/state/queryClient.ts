import { notifyManager, QueryClient } from "@tanstack/solid-query";

notifyManager.setScheduler(queueMicrotask);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: 5 * 60_000 },
    },
  });
}
