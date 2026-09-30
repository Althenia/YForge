import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { UsageRecord } from "../ipc/bindings/UsageRecord";

export const PAGE_SIZE = 25;

export const EARLIER_SESSION_TEXT = "Earlier session — no undo";

export const USAGE_RECORDED = "the type of each Git operation, whether it succeeded, how long it took, and how many Git commands it ran";

export function pageOptions<T extends { id: number }>(
  queryKey: readonly unknown[],
  fetchPage: (before: number | null, limit: number) => Promise<T[]>,
) {
  return {
    queryKey,
    queryFn: ({ pageParam }: { pageParam: number | null }) => fetchPage(pageParam, PAGE_SIZE),
    initialPageParam: null as number | null,
    getNextPageParam: (last: T[]): number | undefined => (last.length < PAGE_SIZE ? undefined : last.at(-1)?.id),
  };
}

export const firstLine = (text: string): string => text.split("\n", 1)[0]?.trim() ?? "";

export const eventLabel = (event: UsageRecord["event"]): string => {
  const words = event.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const usageOutcome = (record: UsageRecord): string => (record.ok ? "succeeded" : `failed (${(record.error_kind ?? "unknown").replaceAll("_", " ")})`);

export const commandCount = (count: number): string => `${count} ${count === 1 ? "command" : "commands"}`;

export function earlierEntries(history: readonly ActivityEntry[], session: readonly ActivityEntry[]): ActivityEntry[] {
  const current = new Set(session.map((entry) => entry.id));
  return history.filter((entry) => !current.has(entry.id));
}
