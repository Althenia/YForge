import { Store, useSelector } from "@tanstack/solid-store";
import type { Accessor } from "solid-js";

export function createStoreValue<T extends object | string | number | boolean | undefined | null>(initial: T): [Accessor<T>, (next: T) => void] {
  const store = new Store<T>(initial as never);
  return [useSelector(store), (next) => store.setState(() => next)];
}

export function createStoreFields<T extends object>(initial: T) {
  const store = new Store<T>(initial as never);
  return <K extends keyof T>(key: K): [Accessor<T[K]>, (next: T[K]) => void] => [
    useSelector(store, (state) => state[key]),
    (next) => store.setState((state) => ({ ...state, [key]: next })),
  ];
}
