import { createRoot, createEffect } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOCK_TICK_MS, createClock, useNow } from "./clock";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shared clock", () => {
  it("ticks the injected source every tick while an owner is subscribed", () => {
    let seconds = 1_000;
    const clock = createClock({ read: () => seconds, tickMs: 10_000 });
    const seen: number[] = [];
    const dispose = createRoot((stop) => {
      const now = clock();
      createEffect(() => seen.push(now()));
      return stop;
    });
    vi.advanceTimersByTime(0);
    seconds = 1_010;
    vi.advanceTimersByTime(10_000);
    seconds = 1_020;
    vi.advanceTimersByTime(10_000);

    expect(seen).toEqual([1_000, 1_010, 1_020]);
    dispose();
  });

  it("runs one timer for all owners and stops it when the last owner is disposed", () => {
    const clock = createClock({ read: () => 5, tickMs: 1_000 });
    const first = createRoot((stop) => {
      clock();
      return stop;
    });
    const second = createRoot((stop) => {
      clock();
      return stop;
    });
    expect(vi.getTimerCount()).toBe(1);

    first();
    expect(vi.getTimerCount()).toBe(1);
    second();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads the wall clock in epoch seconds and ticks about every 30 seconds", () => {
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const start = Math.floor(Date.now() / 1000);
    let now: (() => number) | undefined;
    const dispose = createRoot((stop) => {
      now = useNow();
      return stop;
    });

    expect(now?.()).toBe(start);
    vi.advanceTimersByTime(CLOCK_TICK_MS);
    expect(now?.()).toBe(start + 30);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
