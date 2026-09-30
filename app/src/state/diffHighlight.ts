import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import { highlightLines, type LanguageId, type Segment } from "./syntax";
import type { Range } from "./wordDiff";

export type MarkedSegment = Segment & { changed: boolean };

export const displayText = (text: string): string => text.replace(/\r$/, "");

export function highlightHunk(language: LanguageId | undefined, hunk: DiffHunk): Segment[][] {
  const before: string[] = [];
  const after: string[] = [];
  const position = hunk.lines.map((line) => {
    const text = displayText(line.text);
    if (line.kind !== "added") before.push(text);
    if (line.kind !== "removed") after.push(text);
    return line.kind === "removed" ? before.length - 1 : after.length - 1;
  });
  const oldSide = highlightLines(language, before);
  const newSide = highlightLines(language, after);
  return hunk.lines.map((line, index) => (line.kind === "removed" ? oldSide : newSide)[position[index] ?? 0] ?? []);
}

export function markSegments(segments: readonly Segment[], ranges: readonly Range[] | undefined): MarkedSegment[] {
  if (ranges === undefined || ranges.length === 0) return segments.map((segment) => ({ ...segment, changed: false }));
  const parts: MarkedSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const end = offset + segment.text.length;
    let cursor = offset;
    const push = (to: number, changed: boolean) => {
      if (to > cursor) parts.push({ text: segment.text.slice(cursor - offset, to - offset), kind: segment.kind, changed });
      cursor = Math.max(cursor, to);
    };
    for (const [from, to] of ranges) {
      if (to <= cursor || from >= end) continue;
      push(Math.max(from, cursor), false);
      push(Math.min(to, end), true);
    }
    push(end, false);
    offset = end;
  }
  return parts;
}
