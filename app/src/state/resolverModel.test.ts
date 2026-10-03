import { describe, expect, it } from "vitest";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import {
  assemble,
  choose,
  draftLines,
  initialState,
  markerCount,
  markResolvedReason,
  mergeProgress,
  regionLines,
  regionsOf,
  resolverCommand,
  savedContent,
  sideState,
  step,
  toggleAll,
  toggleSide,
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
const chosen = (choices: ResolverState["choices"], active = 0): ResolverState => ({ choices, active });

describe("conflict regions", () => {
  it("lists the conflict segments in order with their base and starts unresolved on the first", () => {
    const parsed = file();

    expect(regionsOf(parsed)).toEqual([
      { current: ["Run npm start."], incoming: ["Run node app.js.", "Add --verbose."], base: ["Run it."] },
      { current: ["MIT"], incoming: ["Apache"], base: null },
    ]);
    expect(initialState(parsed)).toEqual({ choices: [undefined, undefined], active: 0 });
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
    const output = assemble(file(), chosen(["incoming", "both"]), labels);

    expect(output.text).toBe("# sample\n\nRun node app.js.\nAdd --verbose.\n## License\nMIT\nApache");
    expect(output.starts).toEqual([2, 5]);
  });

  it("puts a proposed text in place of its conflict and keeps the others as chosen or marked", () => {
    const output = assemble(file(), chosen([undefined, "current"]), labels, { 0: "npm start\nnode app.js\n" });

    expect(output.text).toBe("# sample\n\nnpm start\nnode app.js\n## License\nMIT");
    expect(output.starts).toEqual([2, 5]);
  });
});

describe("side checkboxes", () => {
  it("adds and removes a side per conflict, both sides meaning yours then theirs, none meaning unresolved", () => {
    let state = initialState(file());

    state = toggleSide(state, 1, "current");
    expect(state).toEqual({ choices: [undefined, "current"], active: 1 });
    state = toggleSide(state, 1, "incoming");
    expect(state.choices[1]).toBe("both");
    state = toggleSide(state, 1, "current");
    expect(state.choices[1]).toBe("incoming");
    state = toggleSide(state, 1, "incoming");
    expect(state.choices[1]).toBeUndefined();
  });

  it("reads each side's Select all as false, mixed, or true", () => {
    expect(sideState(chosen([undefined, "incoming"]), "current")).toBe("false");
    expect(sideState(chosen([undefined, "incoming"]), "incoming")).toBe("mixed");
    expect(sideState(chosen(["both", "incoming"]), "incoming")).toBe("true");
    expect(sideState(chosen(["both", "incoming"]), "current")).toBe("mixed");
  });

  it("selects a side everywhere unless it is already everywhere, then clears it, keeping the other side", () => {
    const mixed = chosen([undefined, "incoming"]);

    expect(toggleAll(mixed, "incoming").choices).toEqual(["incoming", "incoming"]);
    expect(toggleAll(mixed, "current").choices).toEqual(["current", "both"]);
    expect(toggleAll(chosen(["both", "incoming"]), "incoming").choices).toEqual(["current", undefined]);
  });

  it("chooses one conflict and ignores an unknown one", () => {
    const start = initialState(file());

    expect(choose(start, 1, "both").choices).toEqual([undefined, "both"]);
    expect(choose(start, 5, "incoming")).toBe(start);
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
  it("counts the conflicts whose markers remain and words why Mark resolved waits", () => {
    const marked = assemble(file(), initialState(file()), labels).text;

    expect(markerCount(marked)).toBe(2);
    expect(markResolvedReason(marked)).toBe("2 conflicts left: pick a side or remove the <<<<<<< ======= >>>>>>> markers");
    expect(markResolvedReason("a\n>>>>>>> origin/main")).toBe("1 conflict left: pick a side or remove the <<<<<<< ======= >>>>>>> markers");
    expect(markResolvedReason("Title\n=======\nbody <<<<<<< inline")).toBeUndefined();
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
