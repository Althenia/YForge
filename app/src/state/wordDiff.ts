export type Range = readonly [start: number, end: number];

export type WordChanges = { removed: Range[]; added: Range[] };

const MAX_TOKENS = 400;

const tokenize = (text: string): Array<{ start: number; end: number; text: string }> =>
  [...text.matchAll(/\w+|\s+|[^\w\s]/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));

function unmatchedRanges(tokens: ReadonlyArray<{ start: number; end: number }>, matched: ReadonlySet<number>): Range[] {
  const ranges: Array<[number, number]> = [];
  tokens.forEach((token, index) => {
    if (matched.has(index)) return;
    const last = ranges.at(-1);
    if (last !== undefined && last[1] === token.start) last[1] = token.end;
    else ranges.push([token.start, token.end]);
  });
  return ranges;
}

export function wordChanges(before: string, after: string): WordChanges {
  const left = tokenize(before);
  const right = tokenize(after);
  if (before === after || left.length > MAX_TOKENS || right.length > MAX_TOKENS) return { removed: [], added: [] };
  const width = right.length + 1;
  const common = new Uint16Array((left.length + 1) * width);
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      common[row * width + column] =
        left[row]?.text === right[column]?.text
          ? (common[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(common[(row + 1) * width + column] ?? 0, common[row * width + column + 1] ?? 0);
    }
  }
  const keptLeft = new Set<number>();
  const keptRight = new Set<number>();
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row]?.text === right[column]?.text) {
      keptLeft.add(row);
      keptRight.add(column);
      row += 1;
      column += 1;
    } else if ((common[(row + 1) * width + column] ?? 0) >= (common[row * width + column + 1] ?? 0)) row += 1;
    else column += 1;
  }
  return { removed: unmatchedRanges(left, keptLeft), added: unmatchedRanges(right, keptRight) };
}
