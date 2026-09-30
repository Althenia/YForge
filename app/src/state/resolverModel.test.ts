import { describe, expect, it } from "vitest";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import {
  type Choice,
  choiceLabel,
  choose,
  draftLines,
  initialState,
  markResolvedReason,
  regionLines,
  regionsOf,
  resolverCommand,
  resultLines,
  resultText,
  step,
  takeAll,
  unresolvedCount,
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
const text = (lines: ReturnType<typeof resultLines>) => lines.map((line) => `${line.gutter || " "}|${line.text}`);
const resolved = (choices: ResolverState["choices"]): ResolverState => ({ choices, active: 0 });

describe("conflict regions", () => {
  it("lists the conflict segments in order with their base and starts unresolved on the first", () => {
    const parsed = file();

    expect(regionsOf(parsed)).toEqual([
      { current: ["Run npm start."], incoming: ["Run node app.js.", "Add --verbose."], base: ["Run it."] },
      { current: ["MIT"], incoming: ["Apache"], base: null },
    ]);
    expect(initialState(parsed)).toEqual({ choices: [undefined, undefined], active: 0 });
  });

  it("builds each choice from the region sides in the stated order", () => {
    const [region] = regionsOf(file());
    if (region === undefined) throw new Error("no region");

    expect(regionLines(region, "current")).toEqual(["Run npm start."]);
    expect(regionLines(region, "incoming")).toEqual(["Run node app.js.", "Add --verbose."]);
    expect(regionLines(region, "current_incoming")).toEqual(["Run npm start.", "Run node app.js.", "Add --verbose."]);
    expect(regionLines(region, "incoming_current")).toEqual(["Run node app.js.", "Add --verbose.", "Run npm start."]);
    expect(regionLines(region, { manual: ["mine"] })).toEqual(["mine"]);
  });
});

describe("result pane", () => {
  it("shows unresolved regions as marker lines with C and I gutters and a ! on the opening marker", () => {
    const lines = resultLines(file(), initialState(file()), labels);

    expect(text(lines).slice(0, 8)).toEqual([
      " |# sample",
      " |",
      "!|<<<<<<< main",
      "C|Run npm start.",
      " |=======",
      "I|Run node app.js.",
      "I|Add --verbose.",
      " |>>>>>>> origin/main",
    ]);
    expect(lines.map((line) => line.number)).toEqual(lines.map((_, index) => index + 1));
    expect(lines[2]?.region).toBe(0);
    expect(lines[0]?.region).toBeUndefined();
  });

  it("replaces a resolved region by its lines with the source letters, incoming first when asked", () => {
    const state = resolved(["incoming_current", "current"]);

    expect(text(resultLines(file(), state, labels))).toEqual([
      " |# sample",
      " |",
      "I|Run node app.js.",
      "I|Add --verbose.",
      "C|Run npm start.",
      " |## License",
      "C|MIT",
    ]);
  });

  it("keeps manual edits without a source letter", () => {
    const lines = resultLines(file(), resolved([{ manual: ["hand", "written"] }, "incoming"]), labels);

    expect(text(lines).slice(2, 4)).toEqual([" |hand", " |written"]);
  });
});

describe("assembled text", () => {
  it("is unavailable until every region is resolved and then joins the lines with the file's line ending", () => {
    expect(resultText(file(), resolved(["current", undefined]))).toBeUndefined();

    expect(resultText(file(), resolved(["current_incoming", "incoming"]))).toBe(
      "# sample\n\nRun npm start.\nRun node app.js.\nAdd --verbose.\n## License\nApache\n",
    );
  });

  it("keeps CRLF endings and a missing final newline", () => {
    const crlf = file({ eol: "\r\n", final_newline: false });

    expect(resultText(crlf, resolved(["current", "current"]))).toBe("# sample\r\n\r\nRun npm start.\r\n## License\r\nMIT");
  });

  it("writes an empty file when everything resolves to nothing", () => {
    const empty = file({ segments: [{ kind: "conflict", current: [], incoming: ["x"], base: null }] });

    expect(resultText(empty, resolved(["current"]))).toBe("");
  });
});

describe("state transitions", () => {
  it("chooses per region, takes all from one side, and ignores an unknown region", () => {
    const start = initialState(file());

    expect(choose(start, 1, "incoming").choices).toEqual([undefined, "incoming"]);
    expect(choose(start, 5, "incoming")).toBe(start);
    expect(takeAll(start, "current").choices).toEqual(["current", "current"]);
    expect(takeAll(choose(start, 0, { manual: ["x"] }), "incoming").choices).toEqual(["incoming", "incoming"]);
  });

  it("steps through the regions and wraps around in both directions", () => {
    let state = initialState(file());

    state = step(state, 1);
    expect(state.active).toBe(1);
    expect(step(state, 1).active).toBe(0);
    expect(step(initialState(file()), -1).active).toBe(1);
    expect(step(initialState(file({ segments: [] })), 1).active).toBe(0);
  });

  it("counts unresolved regions and words the reason for the disabled action", () => {
    expect(unresolvedCount(resolved([undefined, "current"]))).toBe(1);
    expect(markResolvedReason(resolved([undefined, undefined]))).toBe("Resolve 2 conflict regions first");
    expect(markResolvedReason(resolved([undefined, "current"]))).toBe("Resolve 1 conflict region first");
    expect(markResolvedReason(resolved(["current", "current"]))).toBeUndefined();
  });

  it("labels each state for the block header", () => {
    const choices: (Choice | undefined)[] = [undefined, "current", "incoming", "current_incoming", "incoming_current", { manual: [] }];
    expect(choices.map(choiceLabel)).toEqual([
      "Unresolved",
      "Current",
      "Incoming",
      "Both · current first",
      "Both · incoming first",
      "Manual",
    ]);
  });

  it("turns edited text back into lines without a phantom trailing line", () => {
    expect(draftLines("")).toEqual([]);
    expect(draftLines("a\nb\n")).toEqual(["a", "b"]);
    expect(draftLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("keyboard", () => {
  const key = (name: string, modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) =>
    resolverCommand({ key: name, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

  it("maps 1, 2, and 3 to current, incoming, and both, and E, N, P to edit and navigation", () => {
    expect(key("1")).toEqual({ kind: "choose", choice: "current" });
    expect(key("2")).toEqual({ kind: "choose", choice: "incoming" });
    expect(key("3")).toEqual({ kind: "choose", choice: "current_incoming" });
    expect(key("e")).toEqual({ kind: "edit" });
    expect(key("N")).toEqual({ kind: "next" });
    expect(key("p")).toEqual({ kind: "previous" });
  });

  it("maps command or control S to mark resolved and ignores other modified or unknown keys", () => {
    expect(key("s", { metaKey: true })).toEqual({ kind: "save" });
    expect(key("s", { ctrlKey: true })).toEqual({ kind: "save" });
    expect(key("1", { metaKey: true })).toBeUndefined();
    expect(key("e", { shiftKey: true })).toBeUndefined();
    expect(key("x")).toBeUndefined();
    expect(key("s")).toBeUndefined();
  });
});
