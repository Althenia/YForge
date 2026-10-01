const NAMED_ITEMS = 3;

export function boundedList(items: readonly string[], noun: string, separator = ", "): string {
  if (items.length <= NAMED_ITEMS) return items.join(separator);
  return `${items.length} ${noun}: ${items.slice(0, NAMED_ITEMS).join(separator)} and ${items.length - NAMED_ITEMS} more`;
}

export const fileList = (paths: string[]): string => boundedList(paths, "files");
