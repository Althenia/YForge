import { describe, expect, it } from "vitest";
import { wordChanges } from "./wordDiff";

const marked = (text: string, ranges: ReadonlyArray<readonly [number, number]>) => ranges.map(([start, end]) => text.slice(start, end));

describe("word-level changes between a removed and an added line", () => {
  it("marks only the changed word on each side", () => {
    const before = "const retries = 3;";
    const after = "const retries = 5;";
    const { removed, added } = wordChanges(before, after);
    expect(marked(before, removed)).toEqual(["3"]);
    expect(marked(after, added)).toEqual(["5"]);
  });

  it("marks an inserted word on the added side only", () => {
    const { removed, added } = wordChanges("call(a, b)", "call(a, extra, b)");
    expect(removed).toEqual([]);
    expect(marked("call(a, extra, b)", added).join("")).toContain("extra");
  });

  it("marks each changed word separately around shared punctuation", () => {
    const { removed } = wordChanges("foo.bar()", "baz.qux()");
    expect(marked("foo.bar()", removed)).toEqual(["foo", "bar"]);
  });

  it("merges adjacent changed tokens into one range", () => {
    const { removed, added } = wordChanges("x=1", "x==2");
    expect(marked("x=1", removed)).toEqual(["1"]);
    expect(marked("x==2", added)).toEqual(["=2"]);
  });

  it("marks nothing for identical lines", () => {
    expect(wordChanges("same line", "same line")).toEqual({ removed: [], added: [] });
  });

  it("marks the whole of each line when nothing is shared", () => {
    expect(wordChanges("abc", "xyz")).toEqual({ removed: [[0, 3]], added: [[0, 3]] });
  });

  it("gives up on very long lines instead of stalling", () => {
    const long = Array.from({ length: 2000 }, (_, index) => `w${index}`).join(" ");
    expect(wordChanges(long, `${long} tail`)).toEqual({ removed: [], added: [] });
  });
});
