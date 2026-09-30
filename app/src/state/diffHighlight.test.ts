import { describe, expect, it } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import { displayText, highlightHunk, markSegments } from "./diffHighlight";
import { loadLanguage } from "./syntax";

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, old_number: 1, new_number: 1, text, no_newline: false });
const hunk = (lines: DiffLine[]): DiffHunk => ({ old_start: 1, old_lines: lines.length, new_start: 1, new_lines: lines.length, heading: "", lines });

describe("hunk highlighting", () => {
  it("highlights the old side for removed lines and the new side for added and context lines", async () => {
    await loadLanguage("rust");
    const highlighted = highlightHunk(
      "rust",
      hunk([line("context", "fn a() {"), line("removed", "    let x = 1;"), line("added", "    let x = 2;"), line("context", "}")]),
    );
    expect(highlighted).toHaveLength(4);
    expect(highlighted[1]).toContainEqual({ text: "1", kind: "number" });
    expect(highlighted[2]).toContainEqual({ text: "2", kind: "number" });
    expect(highlighted[0]).toContainEqual({ text: "fn", kind: "keyword" });
  });

  it("keeps a multi-line comment highlighted across context and added lines", async () => {
    await loadLanguage("css");
    const highlighted = highlightHunk("css", hunk([line("context", "/* start"), line("added", "   middle"), line("context", "end */")]));
    expect(highlighted[1]?.[0]?.kind).toBe("comment");
  });

  it("returns plain text without a language and drops a trailing carriage return", () => {
    const highlighted = highlightHunk(undefined, hunk([line("added", "abc\r")]));
    expect(highlighted[0]).toEqual([{ text: "abc", kind: undefined }]);
    expect(displayText("abc\r")).toBe("abc");
  });
});

describe("word marks over syntax segments", () => {
  it("splits a segment at the marked range and flags the marked part", () => {
    const marked = markSegments([{ text: "let n = 3;", kind: "keyword" }], [[8, 9]]);
    expect(marked).toEqual([
      { text: "let n = ", kind: "keyword", changed: false },
      { text: "3", kind: "keyword", changed: true },
      { text: ";", kind: "keyword", changed: false },
    ]);
  });

  it("marks across segment boundaries", () => {
    const marked = markSegments(
      [
        { text: "ab", kind: "keyword" },
        { text: "cd", kind: undefined },
      ],
      [[1, 3]],
    );
    expect(marked.map((part) => [part.text, part.changed])).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
      ["d", false],
    ]);
  });

  it("leaves the segments unflagged without ranges", () => {
    expect(markSegments([{ text: "abc", kind: undefined }], undefined)).toEqual([{ text: "abc", kind: undefined, changed: false }]);
  });
});
