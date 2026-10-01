import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { ConfirmCopy } from "../state/confirmCopy";
import { ConfirmDialog } from "./ConfirmDialog";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const names = (count: number) => Array.from({ length: count }, (_, index) => `abc000${index} Commit ${index}`);

function mount(copy: ConfirmCopy) {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <ConfirmDialog copy={copy} onConfirm={() => undefined} onCancel={() => undefined} />, host);
  return host;
}

const base: ConfirmCopy = { title: "Rebase?", consequences: [], names: [], confirmLabel: "Rebase" };

describe("ConfirmDialog name list", () => {
  it("counts the names it does not show from the names it was given", () => {
    const host = mount({ ...base, names: names(20) });

    expect(host.querySelectorAll(".dialog-names li.ref")).toHaveLength(8);
    expect(host.querySelector(".dialog-names li:not(.ref)")?.textContent).toBe("and 12 more");
  });

  it("counts the names it does not show from the true total when the list is only a preview", () => {
    const host = mount({ ...base, names: names(20), total: 5000 });

    expect(host.querySelector(".dialog-names li:not(.ref)")?.textContent).toBe("and 4,992 more");
  });

  it("applies the true total to the second list too", () => {
    const host = mount({ ...base, names: ["x"], also: { heading: "Left without a name", names: names(20), total: 1500 } });

    expect(host.querySelector(".dialog-names li:not(.ref)")?.textContent).toBe("and 1,492 more");
  });
});
