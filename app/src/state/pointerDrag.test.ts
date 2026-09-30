import { afterEach, describe, expect, it, vi } from "vitest";
import { beginPointerDrag, DRAG_THRESHOLD } from "./pointerDrag";

const pointer = (type: string, x: number, y: number, button = 0) => new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true });
const down = (x = 0, y = 0, button = 0) => pointer("pointerdown", x, y, button) as PointerEvent;

afterEach(() => document.body.classList.remove("dragging"));

function scene() {
  const hit = vi.fn((x: number) => (x >= 100 ? `target-${x}` : undefined));
  const mark = vi.fn();
  const drop = vi.fn();
  return { hit, mark, drop };
}

describe("pointer drag", () => {
  it("marks the target under the pointer while dragging, sets the window cursor class, and drops on release", () => {
    const { hit, mark, drop } = scene();

    beginPointerDrag(down(), { hit, mark, drop });
    window.dispatchEvent(pointer("pointermove", 100, 0));
    expect(document.body.classList.contains("dragging")).toBe(true);
    expect(mark).toHaveBeenLastCalledWith("target-100");
    window.dispatchEvent(pointer("pointerup", 100, 0));

    expect(drop).toHaveBeenCalledWith("target-100", { left: 100, top: 0 });
    expect(mark).toHaveBeenLastCalledWith(undefined);
    expect(document.body.classList.contains("dragging")).toBe(false);
  });

  it("does nothing for a small movement, a secondary button, or a release over no target", () => {
    const small = scene();
    beginPointerDrag(down(), small);
    window.dispatchEvent(pointer("pointerup", DRAG_THRESHOLD - 1, 0));
    expect(small.drop).not.toHaveBeenCalled();

    const secondary = scene();
    beginPointerDrag(down(0, 0, 2), secondary);
    window.dispatchEvent(pointer("pointermove", 200, 0));
    window.dispatchEvent(pointer("pointerup", 200, 0));
    expect(secondary.drop).not.toHaveBeenCalled();

    const empty = scene();
    beginPointerDrag(down(), empty);
    window.dispatchEvent(pointer("pointermove", 50, 0));
    window.dispatchEvent(pointer("pointerup", 50, 0));
    expect(empty.drop).not.toHaveBeenCalled();
  });

  it("cancels on Escape without dropping and clears the mark", () => {
    const { hit, mark, drop } = scene();

    beginPointerDrag(down(), { hit, mark, drop });
    window.dispatchEvent(pointer("pointermove", 120, 0));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(pointer("pointerup", 120, 0));

    expect(drop).not.toHaveBeenCalled();
    expect(mark).toHaveBeenLastCalledWith(undefined);
    expect(document.body.classList.contains("dragging")).toBe(false);
  });
});
