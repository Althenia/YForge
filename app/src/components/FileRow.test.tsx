import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { FileStatus } from "../ipc/bindings/FileStatus";
import { FileRow } from "./FileRow";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ""; });

describe("file status icons", () => {
  it.each([
    ["modified", "Modified", "edit"], ["added", "Added", "plus"], ["deleted", "Deleted", "minus"],
    ["renamed", "Renamed", "renamed"], ["copied", "Copied", "copy"], ["type_changed", "Type changed", "type_changed"],
    ["untracked", "Untracked", "untracked"], ["conflicted", "Conflicted", "warning"],
  ])("names %s and renders its icon without a status letter", (status, word, icon) => {
    const host = document.createElement("ul");
    document.body.append(host);
    dispose = render(() => <FileRow rowId="file" path="file.ts" originalPath={null} status={status as FileStatus} selected={false} tabStop onFocusRow={() => undefined} virtual={{ index: 0, measure: () => undefined, style: {} }} />, host);
    const badge = host.querySelector(".badge");
    expect(badge?.getAttribute("aria-label")).toBe(word);
    expect(badge?.getAttribute("title")).toBe(word);
    expect(badge?.querySelector("svg")?.getAttribute("data-icon")).toBe(icon);
    expect(badge?.textContent).toBe("");
    expect(host.querySelector("li")?.getAttribute("aria-label")).toBe(`${word} file.ts`);
  });
});
