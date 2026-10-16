import { createComputed, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js";

export type Settled<T> = Accessor<T | undefined> & { pending: Accessor<boolean> };

export function createSettled<S, T>(source: Accessor<S | false | null | undefined>, read: (input: S) => Promise<T>): Settled<T> {
  const [value, setValue] = createSignal<T | undefined>(undefined);
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal<{ error: unknown } | undefined>(undefined);
  const input = createMemo(source);
  createComputed(
    on(input, (next) => {
      let live = true;
      onCleanup(() => {
        live = false;
      });
      setFailure(undefined);
      if (next === false || next === null || next === undefined) {
        setValue(() => undefined);
        setPending(false);
        return;
      }
      setPending(true);
      read(next).then(
        (result) => {
          if (!live) return;
          setValue(() => result);
          setPending(false);
        },
        (error: unknown) => {
          if (!live) return;
          setFailure({ error });
          setPending(false);
        },
      );
    }),
  );
  const settled = (): T | undefined => {
    const failed = failure();
    if (failed !== undefined) throw failed.error;
    return value();
  };
  return Object.assign(settled, { pending });
}
