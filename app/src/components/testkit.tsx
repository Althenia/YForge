import { QueryClientProvider } from "@tanstack/solid-query";
import { createRoot, type JSX } from "solid-js";
import { render } from "solid-js/web";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createMemoryHistory } from "@tanstack/solid-router";
import { createAppRouter } from "../routes";
import { createQueryClient } from "../state/queryClient";
import { createRepoSession } from "../state/repoSession";
import { AppContext, createAppState, type AppState } from "../state/app";

export const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

export function mountWithApp(view: (app: AppState) => JSX.Element): { host: HTMLElement; app: AppState; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  let disposeApp: () => void = () => undefined;
  const app = createRoot((disposeRoot) => {
    disposeApp = disposeRoot;
    return createAppState(createAppRouter(createMemoryHistory({ initialEntries: ["/"] })));
  });
  const disposeView = render(() => <QueryClientProvider client={app.queryClient}><AppContext.Provider value={app}>{view(app)}</AppContext.Provider></QueryClientProvider>, host);
  return {
    host,
    app,
    dispose: () => {
      disposeView();
      disposeApp();
    },
  };
}

export const buttonNamed = (host: ParentNode, text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.replace(/\s+/g, " ").trim() === text);

export function type(input: HTMLInputElement | null | undefined, value: string): void {
  if (input === null || input === undefined) throw new Error("no input");
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

export const testSession = (path: string, snapshot: RepoSnapshot) => createRoot(() => createRepoSession(path, snapshot, createQueryClient()));

const layoutProperties = { offsetHeight: 600, clientHeight: 600, offsetWidth: 800, clientWidth: 800 } as const;

export function stubLayout(): () => void {
  for (const [name, value] of Object.entries(layoutProperties)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 32, width: 800, height: 32, toJSON: () => ({}) });
  document.documentElement.style.setProperty("--controls-row-file", "32px");
  return () => {
    for (const name of Object.keys(layoutProperties)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    HTMLElement.prototype.getBoundingClientRect = rect;
    document.documentElement.style.removeProperty("--controls-row-file");
  };
}
