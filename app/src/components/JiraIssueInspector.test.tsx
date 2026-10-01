import { afterEach, describe, expect, it, vi } from "vitest";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import { JiraIssueInspector } from "./JiraIssueInspector";
import { buttonNamed, flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
});

const connection: JiraConnection = { id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "Sam Lee", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 };

const issue = (overrides: Partial<JiraIssue> = {}): JiraIssue => ({
  key: "ABC-155",
  summary: "Show the account switcher on the login screen",
  status: "In Progress",
  status_category: "in_progress",
  issue_type: "Story",
  project: "ABC",
  assignee: "Sam Lee",
  updated_at: "2026-10-01T09:30:00.000+0000",
  web_url: "https://your-site.atlassian.net/browse/ABC-155",
  connection_id: "j1",
  ...overrides,
});

function mount(found: JiraIssue | undefined, onOpen = vi.fn()) {
  const view = mountWithApp(() => <JiraIssueInspector issueKey="ABC-155" issue={found} connection={connection} onOpen={onOpen} />);
  dispose = view.dispose;
  return { ...view, onOpen };
}

describe("Jira issue inspector", () => {
  it("shows the key, site and project, summary, status and type chips, assignee, update time, and the read-only note", () => {
    const { host } = mount(issue());

    const panel = host.querySelector('aside[aria-label="Issue"]') as HTMLElement;
    expect(panel.querySelector("h2")?.textContent).toBe("Issue ABC-155");
    expect(panel.textContent).toContain("your-site.atlassian.net · Accounts");
    expect(panel.textContent).toContain("Show the account switcher on the login screen");
    expect([...panel.querySelectorAll(".chip")].map((chip) => chip.textContent)).toEqual(["In Progress", "Story"]);
    expect(panel.textContent).toContain("Assigned to you");
    expect(panel.textContent).toMatch(/Updated \d+\w+ ago/);
    expect(panel.textContent).toContain("Read-only. Status and comments change in Jira.");
  });

  it("ages the update time as the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T09:30:20.000Z"));
      const { host } = mount(issue());
      expect(host.textContent).toContain("Updated 20s ago");

      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await flush();

      expect(host.textContent).toContain("Updated 2h ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tones the status chip by category: To Do neutral, In Progress info, Done accent", () => {
    const tone = (overrides: Partial<JiraIssue>) => {
      const { host, dispose: stop } = mount(issue(overrides));
      const chip = host.querySelector(".chip") as HTMLElement;
      const result = [chip.classList.contains("chip-info"), chip.classList.contains("chip-success")];
      stop();
      return result;
    };

    expect(tone({ status: "To Do", status_category: "todo" })).toEqual([false, false]);
    expect(tone({})).toEqual([true, false]);
    expect(tone({ status: "Done", status_category: "done" })).toEqual([false, true]);
  });

  it("opens the issue in the browser from a text button and never offers to change it", () => {
    const { host, onOpen } = mount(issue());

    buttonNamed(host, "Open in browser")?.click();

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "ABC-155" }));
    expect([...host.querySelectorAll("button")].map((button) => button.textContent?.trim())).toEqual(["Open in browser"]);
  });

  it("says in text when the issue is no longer among the open issues assigned to the user", () => {
    const { host } = mount(undefined);

    expect(host.querySelector("h2")?.textContent).toBe("Issue ABC-155");
    expect(host.textContent).toContain("ABC-155 is no longer in your open issues assigned to you.");
    expect(buttonNamed(host, "Open in browser")).toBeUndefined();
  });
});
