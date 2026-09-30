import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { AppContext, createAppState, type AppState } from "../state/app";

export const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

export function mountWithApp(view: (app: AppState) => JSX.Element): { host: HTMLElement; app: AppState; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const app = createAppState();
  const dispose = render(() => <AppContext.Provider value={app}>{view(app)}</AppContext.Provider>, host);
  return { host, app, dispose };
}

export const buttonNamed = (host: ParentNode, text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.replace(/\s+/g, " ").trim() === text);

export function type(input: HTMLInputElement | null | undefined, value: string): void {
  if (input === null || input === undefined) throw new Error("no input");
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
