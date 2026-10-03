import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flush } from "../components/testkit";
import { createIssueChips, type IssueChips } from "./jiraIssues";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  clearMocks();
});

describe("issue chips", () => {
  it("keeps the chips of texts that stay visible while the keys of new texts load (S8)", async () => {
    let release: (() => void) | undefined;
    mockIPC((cmd, args) => {
      if (cmd === "jira_connections_list") return [{ id: "j1" }];
      if (cmd === "jira_issue_keys") {
        const texts = (args as { texts: string[] }).texts;
        const found = texts.map((text) => text.match(/ABC-\d+/g) ?? []);
        if (texts.length === 1) return found;
        return new Promise((resolve) => {
          release = () => resolve(found);
        });
      }
      if (cmd === "jira_issues_lookup") return (args as { keys: string[] }).keys.map((key) => ({ key, issue: null, failure: null }));
      return null;
    });
    const [texts, setTexts] = createSignal<readonly string[]>(["Fix ABC-1 login"]);
    let chips!: IssueChips;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    dispose = render(
      () => (
        <QueryClientProvider client={client}>
          {(() => {
            chips = createIssueChips(texts);
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement("div"),
    );
    await vi.waitFor(() => expect(chips.keysFor("Fix ABC-1 login")).toEqual(["ABC-1"]));

    setTexts(["Fix ABC-1 login", "Add ABC-2 retry"]);
    await flush();

    expect(chips.keysFor("Fix ABC-1 login")).toEqual(["ABC-1"]);
    expect(chips.keysFor("Add ABC-2 retry")).toEqual([]);
    release?.();
    await vi.waitFor(() => expect(chips.keysFor("Add ABC-2 retry")).toEqual(["ABC-2"]));
    expect(chips.keysFor("Fix ABC-1 login")).toEqual(["ABC-1"]);
  });
});
