import { createSignal, getOwner, onCleanup, type Accessor } from "solid-js";

export const CLOCK_TICK_MS = 30_000;

export type ClockSource = {
  read: () => number;
  tickMs: number;
};

const wallClock: ClockSource = { read: () => Math.floor(Date.now() / 1000), tickMs: CLOCK_TICK_MS };

/// One clock per source: a signal of epoch seconds that ticks while at least one owner is subscribed.
export function createClock(source: ClockSource = wallClock): () => Accessor<number> {
  const [seconds, setSeconds] = createSignal(source.read());
  let subscribers = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    subscribers -= 1;
    if (subscribers > 0) return;
    clearInterval(timer);
    timer = undefined;
  };

  return () => {
    if (getOwner() === null) return seconds;
    subscribers += 1;
    if (timer === undefined) {
      setSeconds(source.read());
      timer = setInterval(() => setSeconds(source.read()), source.tickMs);
    }
    onCleanup(stop);
    return seconds;
  };
}

export const useNow = createClock();
