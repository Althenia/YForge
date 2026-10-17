import { afterEach, describe, expect, it } from "vitest";
import type { RepoUiPrefs } from "../ipc/bindings/RepoUiPrefs";
import { GraphSettings } from "./GraphSettings";
import { buttonNamed, flush, mountWithApp, testUiPrefs } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const hidden: RepoUiPrefs = {
  columns: [],
  collapsed_folders: [],
  branch_visibility: { kind: "hidden", refs: [{ name: "feature", kind: "local_branch" }, { name: "v1", kind: "tag" }] },
};

function mount(initial: RepoUiPrefs) {
  const prefs = testUiPrefs(initial);
  const mounted = mountWithApp(() => <GraphSettings anchor={{ left: 0, top: 0 }} prefs={prefs} onClose={() => undefined} />);
  dispose = mounted.dispose;
  return prefs;
}

const radio = (label: string) => [...document.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[type="radio"]')].find((input) => input.parentElement?.textContent?.includes(label)) as HTMLInputElement;
const hiddenList = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Hidden in the graph"] li')].map((entry) => [...entry.children].map((part) => part.textContent?.trim()).join(" "));

describe("graph settings with hidden refs", () => {
  it("keeps All branches chosen and lists each hidden ref with its own Show control", async () => {
    mount(hidden);
    await flush();

    expect(radio("All branches").checked).toBe(true);
    expect(radio("Current + upstream").checked).toBe(false);
    expect(hiddenList()).toEqual(["feature local Show", "v1 tag Show"]);
    expect(document.querySelector('button[aria-label="Show feature in the graph"]')).not.toBeNull();
    expect(buttonNamed(document, "Show all")).not.toBeUndefined();
  });

  it("shows one ref again, then every ref with Show all", async () => {
    const prefs = mount(hidden);
    await flush();

    document.querySelector<HTMLButtonElement>('button[aria-label="Show feature in the graph"]')?.click();
    await flush();
    expect(prefs.prefs().branch_visibility).toEqual({ kind: "hidden", refs: [{ name: "v1", kind: "tag" }] });
    expect(hiddenList()).toEqual(["v1 tag Show"]);

    buttonNamed(document, "Show all")?.click();
    await flush();
    expect(prefs.prefs().branch_visibility).toEqual({ kind: "all" });
    expect(document.querySelector('[aria-label="Hidden in the graph"]')).toBeNull();
    expect(radio("All branches").checked).toBe(true);
  });

  it("drops the hidden list when Current + upstream is chosen", async () => {
    const prefs = mount(hidden);
    await flush();

    radio("Current + upstream").click();
    await flush();

    expect(prefs.prefs().branch_visibility).toEqual({ kind: "current_and_upstream" });
    expect(document.querySelector('[aria-label="Hidden in the graph"]')).toBeNull();
  });

  it("lists nothing while no ref is hidden", async () => {
    mount({ columns: [], collapsed_folders: [], branch_visibility: { kind: "all" } });
    await flush();

    expect(document.querySelector('[aria-label="Hidden in the graph"]')).toBeNull();
    expect(buttonNamed(document, "Show all")).toBeUndefined();
  });
});
