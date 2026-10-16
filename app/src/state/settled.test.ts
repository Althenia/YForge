import { createComponent, createRenderEffect, createRoot, createSignal, ErrorBoundary, Suspense } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { createSettled } from "./settled";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let dispose: (() => void) | undefined;

function paragraph(text: () => string, className = ""): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  createRenderEffect(() => {
    element.textContent = text();
  });
  return element;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

function inRoot<T>(build: () => T): T {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return build();
  });
}

describe("createSettled", () => {
  it("is pending with no value until the read fulfils, then holds the result", async () => {
    const gate = deferred<string>();
    const settled = inRoot(() => createSettled(() => "a", () => gate.promise));

    expect(settled()).toBeUndefined();
    expect(settled.pending()).toBe(true);
    gate.resolve("result");
    await tick();

    expect(settled()).toBe("result");
    expect(settled.pending()).toBe(false);
  });

  it("holds the previous result while the next read is pending", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const [source, setSource] = createSignal("a");
    const settled = inRoot(() =>
      createSettled(source, (input) => {
        const gate = deferred<string>();
        gates.set(input, gate);
        return gate.promise;
      }),
    );
    gates.get("a")?.resolve("first");
    await tick();

    setSource("b");

    expect(settled()).toBe("first");
    expect(settled.pending()).toBe(true);
    gates.get("b")?.resolve("second");
    await tick();
    expect(settled()).toBe("second");
    expect(settled.pending()).toBe(false);
  });

  it("never lands a superseded read that resolves late", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const [source, setSource] = createSignal("a");
    const settled = inRoot(() =>
      createSettled(source, (input) => {
        const gate = deferred<string>();
        gates.set(input, gate);
        return gate.promise;
      }),
    );
    setSource("b");

    gates.get("b")?.resolve("second");
    await tick();
    gates.get("a")?.resolve("stale");
    await tick();

    expect(settled()).toBe("second");
    expect(settled.pending()).toBe(false);
  });

  it("leaves a superseded read from changing pending while the current read is in flight", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const [source, setSource] = createSignal("a");
    const settled = inRoot(() =>
      createSettled(source, (input) => {
        const gate = deferred<string>();
        gates.set(input, gate);
        return gate.promise;
      }),
    );
    setSource("b");

    gates.get("a")?.resolve("stale");
    await tick();

    expect(settled()).toBeUndefined();
    expect(settled.pending()).toBe(true);
  });

  it.each([false, null, undefined] as const)("clears the value and supersedes the in-flight read when the source is %s", async (empty) => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const [source, setSource] = createSignal<string | false | null | undefined>("a");
    const settled = inRoot(() =>
      createSettled(source, (input) => {
        const gate = deferred<string>();
        gates.set(input, gate);
        return gate.promise;
      }),
    );
    gates.get("a")?.resolve("first");
    await tick();
    setSource("b");

    setSource(empty);

    expect(settled()).toBeUndefined();
    expect(settled.pending()).toBe(false);
    gates.get("b")?.resolve("late");
    await tick();
    expect(settled()).toBeUndefined();
    expect(settled.pending()).toBe(false);
  });

  it("reads the empty string", async () => {
    const reads: string[] = [];
    const settled = inRoot(() =>
      createSettled(() => "", async (input) => {
        reads.push(input);
        return "empty";
      }),
    );
    await tick();

    expect(reads).toEqual([""]);
    expect(settled()).toBe("empty");
  });

  it("throws the failure to the nearest error boundary", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(
      () =>
        createComponent(ErrorBoundary, {
          fallback: (error: unknown) => paragraph(() => `Failed: ${error instanceof Error ? error.message : String(error)}`),
          get children() {
            const settled = createSettled(
              () => "bad",
              async () => {
                throw new Error("read refused");
              },
            );
            return paragraph(() => `${settled() ?? "none"}`);
          },
        }),
      host,
    );
    await tick();

    expect(host.textContent).toBe("Failed: read refused");
  });

  it("reports the rejection through pending and clears it on the next source value", async () => {
    const [source, setSource] = createSignal("bad");
    const settled = inRoot(() =>
      createSettled(source, async (input) => {
        if (input === "bad") throw new Error("read refused");
        return `ok ${input}`;
      }),
    );
    await tick();

    expect(settled.pending()).toBe(false);
    expect(() => settled()).toThrow("read refused");
    setSource("good");
    await tick();
    expect(settled()).toBe("ok good");
  });

  it("never shows the Suspense fallback while a read is pending", async () => {
    const gate = deferred<string>();
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(
      () =>
        createComponent(Suspense, {
          fallback: paragraph(() => "Loading the page…"),
          get children() {
            const settled = createSettled(() => "a", () => gate.promise);
            return paragraph(() => settled() ?? "waiting", "content");
          },
        }),
      host,
    );
    const content = host.querySelector(".content");

    expect(host.textContent).toBe("waiting");
    await tick();
    expect(host.textContent).not.toContain("Loading the page…");
    gate.resolve("done");
    await tick();

    expect(host.textContent).toBe("done");
    expect(host.querySelector(".content")).toBe(content);
    expect(content?.isConnected).toBe(true);
  });
});
