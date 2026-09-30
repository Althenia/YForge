import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefTarget } from "../state/refMenu";
import { beginLabelDrag, DRAG_THRESHOLD, type LabelHit } from "./labelDrag";

const branch = (name: string): RefTarget => ({ kind: "local_branch", name, remoteName: undefined, startPoint: "abc1234" });
const source = branch("feature");

const pointer = (type: string, x: number, y: number, button = 0) => new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true });
const down = (x = 0, y = 0, button = 0) => pointer("pointerdown", x, y, button) as PointerEvent;

function scene() {
  const main = document.createElement("span");
  const own = document.createElement("span");
  const hits: Record<string, LabelHit> = {
    "100,0": { target: branch("main"), element: main },
    "50,0": { target: source, element: own },
  };
  const hitAt = (x: number, y: number) => hits[`${x},${y}`];
  const dropped = vi.fn();
  return { main, own, hitAt, dropped };
}

afterEach(() => document.body.classList.remove("dragging"));

describe("ref label drag", () => {
  it("drops on another label after moving past the threshold and reports the drop point", () => {
    const { hitAt, dropped } = scene();

    beginLabelDrag(down(), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointermove", 100, 0));
    window.dispatchEvent(pointer("pointerup", 100, 0));

    expect(dropped).toHaveBeenCalledWith(source, branch("main"), { left: 100, top: 0 });
  });

  it("drops when the release itself carries the move and no move event was seen", () => {
    const { hitAt, dropped } = scene();

    beginLabelDrag(down(), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointerup", 100, 0));

    expect(dropped).toHaveBeenCalledWith(source, branch("main"), { left: 100, top: 0 });
  });

  it("marks the label under the pointer while dragging and clears every mark afterwards", () => {
    const { main, hitAt, dropped } = scene();

    beginLabelDrag(down(), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointermove", 100, 0));
    expect(main.classList.contains("drop-target")).toBe(true);
    expect(document.body.classList.contains("dragging")).toBe(true);
    window.dispatchEvent(pointer("pointermove", 300, 0));
    expect(main.classList.contains("drop-target")).toBe(false);
    window.dispatchEvent(pointer("pointerup", 300, 0));

    expect(document.body.classList.contains("dragging")).toBe(false);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("treats a press that stays under the threshold as a click, not a drag", () => {
    const { hitAt, dropped } = scene();

    beginLabelDrag(down(100, 0), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointermove", 100 + DRAG_THRESHOLD - 2, 0));
    window.dispatchEvent(pointer("pointerup", 100, 0));

    expect(dropped).not.toHaveBeenCalled();
    expect(document.body.classList.contains("dragging")).toBe(false);
  });

  it("ignores a drop on the dragged label itself and non-primary buttons", () => {
    const { hitAt, dropped } = scene();

    beginLabelDrag(down(), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointermove", 50, 0));
    window.dispatchEvent(pointer("pointerup", 50, 0));
    beginLabelDrag(down(0, 0, 2), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointermove", 100, 0));
    window.dispatchEvent(pointer("pointerup", 100, 0));

    expect(dropped).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { hitAt, dropped } = scene();

    beginLabelDrag(down(), source, hitAt, dropped);
    window.dispatchEvent(pointer("pointermove", 100, 0));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(pointer("pointerup", 100, 0));

    expect(dropped).not.toHaveBeenCalled();
    expect(document.body.classList.contains("dragging")).toBe(false);
  });
});
