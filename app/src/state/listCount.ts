export type Paged = { total: number | null; capped: boolean };

const LIST_CAP = 1000;

export const formatCount = (count: number): string => count.toLocaleString("en-US");

export const countOf = (loaded: number, paged: Paged): number => paged.total ?? loaded;

export function cappedText(paged: Paged): string | undefined {
  if (!paged.capped) return undefined;
  return paged.total === null ? `Showing the first ${formatCount(LIST_CAP)}` : `Showing ${formatCount(LIST_CAP)} of ${formatCount(paged.total)}`;
}

export function partialFilesNote(loaded: number, paged: Paged): string | undefined {
  if (!paged.capped && (paged.total === null || paged.total <= loaded)) return undefined;
  const sums = `Additions and deletions cover only the ${formatCount(loaded)} loaded files`;
  const capped = cappedText(paged);
  return capped === undefined ? sums : `${capped}. ${sums}`;
}
