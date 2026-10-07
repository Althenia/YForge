import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import { EmptyRepository } from "./EmptyRepository";
import { flush } from "./testkit";
import { stubScrollLayout } from "./virtualTestkit";

const ROW = 32;
const VIEWPORT = 320;
const TOTAL = 5000;

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  restoreLayout = stubScrollLayout({ viewport: VIEWPORT, row: ROW, total: TOTAL });
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
  await flush();
  document.body.innerHTML = "";
});

const snapshotOf = (count: number): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "unborn", name: "main" },
    files: Array.from({ length: count }, (_, index) => ({ path: `src/file-${index}.ts`, original_path: null, area: "untracked", status: "untracked" })),
  }) as unknown as RepoSnapshot;

async function mount(count: number, stageAll: () => Promise<unknown> = async () => undefined) {
  const host = document.createElement("div");
  document.body.append(host);
  const actions = { stageAll } as unknown as RepoActions;
  dispose = render(() => <EmptyRepository snapshot={snapshotOf(count)} actions={actions} />, host);
  await flush(60);
  const scroller = host.querySelector<HTMLElement>(".empty-repo-list") as HTMLElement;
  const paths = () => [...host.querySelectorAll(".empty-files .frow .path")].map((path) => path.textContent);
  const scrollTo = async (top: number) => {
    scroller.scrollTop = top;
    await flush(60);
  };
  return { host, paths, scrollTo };
}

describe("empty repository file list", () => {
  it("announces staging and locks the first-commit action until it completes", async () => {
    let finish: (() => void) | undefined;
    let calls = 0;
    const { host } = await mount(1, () => {
      calls += 1;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const button = host.querySelector<HTMLButtonElement>(".empty-repo button");
    button?.click();
    await flush();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Staging files");
    button?.click();
    expect(calls).toBe(1);
    finish?.();
    await flush();
    expect(button?.disabled).toBe(false);
  });
  it("lists a handful of untracked files with their status letters", async () => {
    const { host, paths } = await mount(3);

    expect(paths()).toEqual(["src/file-0.ts", "src/file-1.ts", "src/file-2.ts"]);
    expect([...host.querySelectorAll(".empty-files .badge")].map((badge) => badge.textContent)).toEqual(["U", "U", "U"]);
    expect(host.querySelector("h3")?.textContent).toBe("Files · 3");
    expect(host.querySelector<HTMLElement>(".empty-repo-list")?.tabIndex).toBe(0);
  });

  it("renders only the rows in view for 5,000 files, in a list as tall as all of them", async () => {
    const { host, paths } = await mount(TOTAL);

    expect(paths().length).toBeGreaterThan(0);
    expect(paths().length).toBeLessThan(60);
    expect(paths()[0]).toBe("src/file-0.ts");
    expect(host.querySelector<HTMLElement>(".empty-files")?.style.height).toBe(`${TOTAL * ROW}px`);
  });

  it("reaches the last file by scrolling to the end", async () => {
    const { paths, scrollTo } = await mount(TOTAL);

    await scrollTo(TOTAL * ROW);

    expect(paths()).toContain(`src/file-${TOTAL - 1}.ts`);
    expect(paths().length).toBeLessThan(60);
  });
});
