import { describe, expect, it } from "vitest";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import {
  anchorAtScroll,
  assemble,
  choose,
  draftLines,
  initialState,
  markerCount,
  markResolvedReason,
  mergeProgress,
  pickedLines,
  regionLines,
  regionSideState,
  regionsOf,
  resolverCommand,
  savedContent,
  scrollTopAtAnchor,
  sideState,
  step,
  toggleAll,
  toggleLinePick,
  toggleSide,
  type RegionPick,
  type ResolverState,
} from "./resolverModel";

const file = (overrides: Partial<ConflictFile> = {}): ConflictFile => ({
  file: "README.md",
  eol: "\n",
  final_newline: true,
  binary: false,
  sides: { base: true, current: true, incoming: true },
  segments: [
    { kind: "text", lines: ["# sample", ""] },
    { kind: "conflict", current: ["Run npm start."], incoming: ["Run node app.js.", "Add --verbose."], base: ["Run it."] },
    { kind: "text", lines: ["## License"] },
    { kind: "conflict", current: ["MIT"], incoming: ["Apache"], base: null },
  ],
  ...overrides,
});

const labels = { current: "main", incoming: "origin/main" };
const pick = (side: RegionPick["side"], lineIndex: number): RegionPick => ({ side, lineIndex });
const chosen = (picks: ResolverState["picks"], active = 0): ResolverState => ({ picks, active });

describe("conflict regions", () => {
  it("lists the conflict segments in order with their base and starts unresolved on the first", () => {
    const parsed = file();

    expect(regionsOf(parsed)).toEqual([
      { current: ["Run npm start."], incoming: ["Run node app.js.", "Add --verbose."], base: ["Run it."] },
      { current: ["MIT"], incoming: ["Apache"], base: null },
    ]);
    expect(initialState(parsed)).toEqual({ picks: [[], []], active: 0 });
  });

  it("builds yours, theirs, and both (yours first) from the region sides", () => {
    const [region] = regionsOf(file());
    if (region === undefined) throw new Error("no region");

    expect(regionLines(region, "current")).toEqual(["Run npm start."]);
    expect(regionLines(region, "incoming")).toEqual(["Run node app.js.", "Add --verbose."]);
    expect(regionLines(region, "both")).toEqual(["Run npm start.", "Run node app.js.", "Add --verbose."]);
  });
});

describe("output", () => {
  it("shows every unresolved conflict as Git's markers named by branch and records where each conflict starts", () => {
    const output = assemble(file(), initialState(file()), labels);

    expect(output.text.split("\n")).toEqual([
      "# sample",
      "",
      "<<<<<<< main",
      "Run npm start.",
      "=======",
      "Run node app.js.",
      "Add --verbose.",
      ">>>>>>> origin/main",
      "## License",
      "<<<<<<< main",
      "MIT",
      "=======",
      "Apache",
      ">>>>>>> origin/main",
    ]);
    expect(output.starts).toEqual([2, 9]);
  });

  it("replaces a chosen conflict by its lines and moves the later starts with it", () => {
    const output = assemble(file(), chosen([[pick("incoming", 0), pick("incoming", 1)], [pick("current", 0), pick("incoming", 0)]]), labels);

    expect(output.text).toBe("# sample\n\nRun node app.js.\nAdd --verbose.\n## License\nMIT\nApache");
    expect(output.starts).toEqual([2, 5]);
  });

  it("puts a proposed text in place of its conflict and keeps the others as chosen or marked", () => {
    const output = assemble(file(), chosen([[], [pick("current", 0)]]), labels, { 0: "npm start\nnode app.js\n" });

    expect(output.text).toBe("# sample\n\nnpm start\nnode app.js\n## License\nMIT");
    expect(output.starts).toEqual([2, 5]);
  });
});

describe("side checkboxes", () => {
  it("adds and removes a whole side per conflict, keeping the other side's picks", () => {
    const regions = regionsOf(file());
    let state = initialState(file());

    state = toggleSide(state, 1, "current", regions[1]!);
    expect(state).toEqual({ picks: [[], [pick("current", 0)]], active: 1 });
    state = toggleSide(state, 1, "incoming", regions[1]!);
    expect(state.picks[1]).toEqual([pick("current", 0), pick("incoming", 0)]);
    state = toggleSide(state, 1, "current", regions[1]!);
    expect(state.picks[1]).toEqual([pick("incoming", 0)]);
    state = toggleSide(state, 1, "incoming", regions[1]!);
    expect(state.picks[1]).toEqual([]);
  });

  it("appends individual lines in click order and removes a line when unchecked", () => {
    const region = regionsOf(file())[0]!;
    let state = initialState(file());

    state = toggleLinePick(state, 0, pick("incoming", 1));
    state = toggleLinePick(state, 0, pick("current", 0));
    state = toggleLinePick(state, 0, pick("incoming", 0));

    expect(state.picks[0]).toEqual([pick("incoming", 1), pick("current", 0), pick("incoming", 0)]);
    expect(pickedLines(region, state.picks[0]!)).toEqual(["Add --verbose.", "Run npm start.", "Run node app.js."]);
    expect(assemble(file(), state, labels).text).toContain("Add --verbose.\nRun npm start.\nRun node app.js.");

    state = toggleLinePick(state, 0, pick("current", 0));
    expect(state.picks[0]).toEqual([pick("incoming", 1), pick("incoming", 0)]);
  });

  it("reads a region side as true, mixed, or false, including an explicitly chosen empty side", () => {
    const region = regionsOf(file())[0]!;
    const emptyRegion = { current: [], incoming: ["kept"], base: null };

    expect(regionSideState(region, [], "incoming")).toBe("false");
    expect(regionSideState(region, [pick("incoming", 0)], "incoming")).toBe("mixed");
    expect(regionSideState(region, [pick("incoming", 0), pick("incoming", 1)], "incoming")).toBe("true");
    expect(regionSideState(emptyRegion, [], "current")).toBe("false");
    expect(regionSideState(emptyRegion, [pick("current", -1)], "current")).toBe("true");
    expect(pickedLines(emptyRegion, [pick("current", -1)])).toEqual([]);
  });

  it("replaces a partial side with every line in order when its region checkbox is clicked, keeping the other side", () => {
    const region = regionsOf(file())[0]!;
    const state = chosen([[pick("current", 0), pick("incoming", 1)]]);

    expect(toggleSide(state, 0, "incoming", region).picks[0]).toEqual([pick("current", 0), pick("incoming", 0), pick("incoming", 1)]);
  });

  it("reads each side's Select all as false, mixed, or true", () => {
    const regions = regionsOf(file());

    expect(sideState(chosen([[], [pick("incoming", 0)]]), "current", regions)).toBe("false");
    expect(sideState(chosen([[], [pick("incoming", 0)]]), "incoming", regions)).toBe("mixed");
    expect(sideState(chosen([[pick("incoming", 0)], [pick("incoming", 0)]]), "incoming", regions)).toBe("mixed");
    expect(sideState(chosen([[pick("incoming", 0), pick("incoming", 1)], [pick("incoming", 0)]]), "incoming", regions)).toBe("true");
  });

  it("selects a side everywhere unless it is already everywhere, then clears it, keeping the other side", () => {
    const regions = regionsOf(file());
    const mixed = chosen([[], [pick("incoming", 0)]]);

    expect(toggleAll(mixed, "incoming", regions).picks).toEqual([[pick("incoming", 0), pick("incoming", 1)], [pick("incoming", 0)]]);
    expect(toggleAll(mixed, "current", regions).picks).toEqual([[pick("current", 0)], [pick("incoming", 0), pick("current", 0)]]);
    expect(toggleAll(chosen([[pick("current", 0), pick("incoming", 0), pick("incoming", 1)], [pick("incoming", 0)]]), "incoming", regions).picks).toEqual([[pick("current", 0)], []]);
  });

  it("chooses one conflict and ignores an unknown one", () => {
    const start = initialState(file());

    expect(choose(start, 1, "both", regionsOf(file())).picks).toEqual([[], [pick("current", 0), pick("incoming", 0)]]);
    expect(choose(start, 5, "incoming", regionsOf(file()))).toBe(start);
  });

  it("steps through the conflicts and wraps around in both directions", () => {
    const state = step(initialState(file()), 1);

    expect(state.active).toBe(1);
    expect(step(state, 1).active).toBe(0);
    expect(step(initialState(file()), -1).active).toBe(1);
    expect(step(initialState(file({ segments: [] })), 1).active).toBe(0);
  });
});

describe("markers and the saved text", () => {
  it("counts every conflict marker line and words why Mark resolved waits", () => {
    const marked = assemble(file(), initialState(file()), labels).text;

    expect(markerCount(marked)).toBe(6);
    expect(markerCount("<<<<<<< main\na")).toBe(1);
    expect(markerCount("a\n=======\nb")).toBe(1);
    expect(markerCount("a\n||||||| base\nb")).toBe(1);
    expect(markerCount("a\n>>>>>>> origin/main")).toBe(1);
    expect(markerCount("Title\n=======\nbody <<<<<<< inline")).toBe(1);
    expect(markerCount("body <<<<<<< inline")).toBe(0);
    expect(markResolvedReason(marked)).toBe("6 conflict markers left: pick a side or remove the <<<<<<< ======= >>>>>>> markers");
    expect(markResolvedReason("a\n>>>>>>> origin/main")).toBe("1 conflict marker left: pick a side or remove the <<<<<<< ======= >>>>>>> markers");
    expect(markResolvedReason("plain text")).toBeUndefined();
  });

  it("saves the Output with the file's line ending and final newline, keeping a trailing blank line", () => {
    expect(savedContent(file(), "a\nb")).toBe("a\nb\n");
    expect(savedContent(file({ eol: "\r\n", final_newline: false }), "a\n\nb")).toBe("a\r\n\r\nb");
    expect(savedContent(file(), "a\n")).toBe("a\n\n");
    expect(savedContent(file(), "")).toBe("");
  });

  it("turns proposed text into lines without a phantom trailing line", () => {
    expect(draftLines("")).toEqual([]);
    expect(draftLines("a\nb\n")).toEqual(["a", "b"]);
    expect(draftLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("scroll mapping", () => {
  it("maps a scroll position to a segment and fraction and back to another pane", () => {
    const yours = [2, 1, 3];
    const output = [2, 4, 1];

    expect(anchorAtScroll(yours, 50, 40, 120, 20)).toEqual({ segmentIndex: 1, fraction: 0.5 });
    expect(scrollTopAtAnchor(output, { segmentIndex: 1, fraction: 0.5 }, 40, 140, 20)).toBe(80);
    expect(scrollTopAtAnchor(yours, anchorAtScroll(yours, 50, 40, 120, 20), 40, 120, 20)).toBe(50);
  });

  it("returns zero without NaN when a pane fits or has only empty segments", () => {
    expect(anchorAtScroll([0, 0], 10, 40, 30, 20)).toEqual({ segmentIndex: 0, fraction: 0 });
    expect(anchorAtScroll([2, 1], 10, 40, 30, 20)).toEqual({ segmentIndex: 0, fraction: 0 });
    expect(scrollTopAtAnchor([0, 2], { segmentIndex: 1, fraction: 0.5 }, 40, 30, 20)).toBe(0);
    expect(scrollTopAtAnchor([2, 1], { segmentIndex: 9, fraction: 2 }, 40, 120, 20)).not.toBeNaN();
  });

  it("skips zero-line segments when anchoring", () => {
    expect(anchorAtScroll([2, 0, 2], 50, 40, 80, 20)).toEqual({ segmentIndex: 2, fraction: 0.25 });
  });
});

describe("merge bar", () => {
  it("states the files resolved and why Commit merge waits", () => {
    expect(mergeProgress({ conflicted: 2, resolved: 1, busy: false })).toEqual({ label: "1 of 3 files resolved", commitReason: "Resolve 2 files first" });
    expect(mergeProgress({ conflicted: 1, resolved: 0, busy: false })).toEqual({ label: "0 of 1 files resolved", commitReason: "Resolve 1 file first" });
    expect(mergeProgress({ conflicted: 0, resolved: 2, busy: false })).toEqual({ label: "2 of 2 files resolved", commitReason: undefined });
    expect(mergeProgress({ conflicted: 0, resolved: 2, busy: true }).commitReason).toBe("Working…");
  });
});

describe("keyboard", () => {
  const key = (name: string, modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) =>
    resolverCommand({ key: name, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

  it("maps 1, 2, and 3 to yours, theirs, and both, and N and P to the next and previous conflict", () => {
    expect(key("1")).toEqual({ kind: "choose", choice: "current" });
    expect(key("2")).toEqual({ kind: "choose", choice: "incoming" });
    expect(key("3")).toEqual({ kind: "choose", choice: "both" });
    expect(key("N")).toEqual({ kind: "next" });
    expect(key("p")).toEqual({ kind: "previous" });
  });

  it("maps command or control S to mark resolved and ignores other modified or unknown keys", () => {
    expect(key("s", { metaKey: true })).toEqual({ kind: "save" });
    expect(key("s", { ctrlKey: true })).toEqual({ kind: "save" });
    expect(key("1", { metaKey: true })).toBeUndefined();
    expect(key("n", { shiftKey: true })).toBeUndefined();
    expect(key("e")).toBeUndefined();
    expect(key("s")).toBeUndefined();
  });
});
