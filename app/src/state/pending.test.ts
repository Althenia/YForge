import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingIndicator, PENDING_DELAY_MS, PENDING_MIN_MS } from "./pending";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  return createRoot((dispose) => {
    const [pending, setPending] = createSignal(false);
    const shown = createPendingIndicator(pending);
    return { shown, setPending, dispose };
  });
}

describe("pending indicator", () => {
  it("uses the approved 150ms delay and 400ms minimum (S72)", () => {
    expect(PENDING_DELAY_MS).toBe(150);
    expect(PENDING_MIN_MS).toBe(400);
  });

  it("never shows work that finishes within 150ms", () => {
    const view = harness();
    view.setPending(true);
    vi.advanceTimersByTime(149);
    view.setPending(false);
    vi.advanceTimersByTime(1_000);
    expect(view.shown()).toBe(false);
    view.dispose();
  });

  it("shows pending work once it has lasted 150ms", () => {
    const view = harness();
    view.setPending(true);
    vi.advanceTimersByTime(149);
    expect(view.shown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(view.shown()).toBe(true);
    view.dispose();
  });

  it("keeps a shown indicator for at least 400ms after it appeared", () => {
    const view = harness();
    view.setPending(true);
    vi.advanceTimersByTime(200);
    view.setPending(false);
    vi.advanceTimersByTime(349);
    expect(view.shown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(view.shown()).toBe(false);
    view.dispose();
  });

  it("hides at once when the indicator has already been visible for 400ms", () => {
    const view = harness();
    view.setPending(true);
    vi.advanceTimersByTime(1_000);
    view.setPending(false);
    expect(view.shown()).toBe(false);
    view.dispose();
  });

  it("stays shown without flicker when work resumes during the minimum", () => {
    const view = harness();
    view.setPending(true);
    vi.advanceTimersByTime(200);
    view.setPending(false);
    vi.advanceTimersByTime(100);
    view.setPending(true);
    vi.advanceTimersByTime(1_000);
    expect(view.shown()).toBe(true);
    view.setPending(false);
    expect(view.shown()).toBe(false);
    view.dispose();
  });

  it("starts the delay again for a new burst after the indicator hid", () => {
    const view = harness();
    view.setPending(true);
    vi.advanceTimersByTime(600);
    view.setPending(false);
    expect(view.shown()).toBe(false);
    view.setPending(true);
    vi.advanceTimersByTime(149);
    expect(view.shown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(view.shown()).toBe(true);
    view.dispose();
  });

  it("clears its timers when its owner is disposed", () => {
    const view = harness();
    view.setPending(true);
    view.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
