import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { LaunchpadPull } from "../ipc/bindings/LaunchpadPull";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import type { RecentStatus } from "../ipc/bindings/RecentStatus";
import type { Repositories } from "../ipc/bindings/Repositories";
import type { Wip } from "../ipc/bindings/Wip";
import { takeConnectKind, takePullInspector } from "../state/connectRequest";
import { Launchpad } from "./Launchpad";
import { buttonNamed, choose, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

beforeEach(() => {
  mockWindows("main");
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
  vi.restoreAllMocks();
  takeConnectKind();
});

const gitlab: PlatformConnection = { id: "c1", kind: "gitlab", host: "gitlab.corp-a.com", name: "GitLab", insecure_tls: false, created_at: 1 };
const bitbucket: PlatformConnection = { id: "c2", kind: "bitbucket", host: "bitbucket.corp-b.com", name: "Bitbucket", insecure_tls: false, created_at: 2 };
const site: JiraConnection = { id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "V", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 };

const pull = (connection: string, number: number, title: string, overrides: Partial<LaunchpadPull> = {}): LaunchpadPull => ({
  connection_id: connection,
  repo: { owner: "platform", repo: "api" },
  role: "authored",
  draft: false,
  local_path: null,
  pull: { number, title, body: "", state: "open", source_ref: "fix/ABC-142-retry", target_ref: "main", author: "nok", created_at: "2026-10-01T06:00:00Z", updated_at: "2026-10-01T06:00:00Z", mergeable: null, web_url: `https://host/pr/${number}` },
  ...overrides,
});

const issue = (key: string, summary: string): JiraIssue => ({ key, summary, status: "In Progress", status_category: "in_progress", issue_type: "Story", project: key.split("-")[0] as string, assignee: "V", updated_at: "", web_url: `https://your-site.atlassian.net/browse/${key}`, connection_id: "j1" });

type Data = {
  platform?: PlatformConnection[];
  pulls?: Record<string, LaunchpadPull[] | { kind: string; message: string }>;
  pages?: Record<string, { total: number | null; capped: boolean }>;
  jira?: JiraConnection[];
  issues?: JiraIssue[];
  issuePage?: { total: number | null; capped: boolean };
  wips?: Wip[];
  repositories?: Repositories;
  statuses?: RecentStatus[];
  answer?: (call: Call) => unknown;
  tab?: string;
};

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(data: Data) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "platform_connections_list") return data.platform ?? [];
      if (cmd === "platform_my_pulls") {
        const found = data.pulls?.[(args as { id: string }).id] ?? [];
        if (!Array.isArray(found)) throw { kind: found.kind, message: found.message, output: null };
        return { pulls: found, ...(data.pages?.[(args as { id: string }).id] ?? { total: found.length, capped: false }) };
      }
      if (cmd === "jira_connections_list") return data.jira ?? [];
      if (cmd === "jira_my_issues") return { issues: data.issues ?? [], ...(data.issuePage ?? { total: (data.issues ?? []).length, capped: false }) };
      if (cmd === "launchpad_wips") return data.wips ?? [];
      if (cmd === "repositories_list") return data.repositories ?? { folders: [], repos: [] };
      if (cmd === "recent_statuses") return data.statuses ?? [];
      const answered = data.answer?.({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (answered !== undefined) return answered;
      if (cmd === "jira_issue_keys") return (args as { texts: string[] }).texts.map((text) => text.match(/ABC-\d+/g) ?? []);
      if (cmd === "jira_issues_lookup") return (args as { keys: string[] }).keys.map((key) => ({ key, issue: issue(key, "Retry login"), failure: null }));
      return null;
    },
    { shouldMockEvents: true },
  );
  const view = mountWithApp(() => <Launchpad />);
  dispose = view.dispose;
  await flush(80);
  const start = data.tab ?? "My pull requests";
  if (start !== "Repositories") {
    tab(view.host, start).click();
    await flush();
  }
  return { ...view, calls };
}

const tab = (host: ParentNode, label: string) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((entry) => entry.textContent?.startsWith(label)) as HTMLElement;
const sourceLine = (host: ParentNode, name: string) => [...host.querySelectorAll<HTMLElement>(".lp-sources .status-line")].map((line) => line.textContent?.trim() ?? "").find((text) => text.startsWith(name)) ?? "";
const rows = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>(".lp-row .lp-open")].map((row) => row.getAttribute("aria-label"));

describe("Launchpad pull requests", () => {
  it("says no service is connected and offers Connect for each missing service", async () => {
    const { host, app } = await mount({});

    expect(host.textContent).toContain("No pull request service is connected");
    expect(["Connect GitHub", "Connect GitLab", "Connect Bitbucket"].map((name) => buttonNamed(host, name) !== undefined)).toEqual([true, true, true]);
    buttonNamed(host, "Connect GitLab")?.click();
    await flush();

    expect(takeConnectKind()).toBe("gitlab");
    expect(app.takePlatformAddRequest()).toBe(true);
  });

  it("shows each tab with its count in text and groups review requests before authored pull requests", async () => {
    const { host } = await mount({
      platform: [gitlab, bitbucket],
      pulls: { c1: [pull("c1", 418, "Retry login", { role: "review_requested" }), pull("c1", 421, "Document proxy", { draft: true })], c2: [pull("c2", 77, "Pin image", { connection_id: "c2", repo: { owner: "ops", repo: "ci" } })] },
      jira: [site],
      issues: [issue("ABC-155", "Switcher")],
      wips: [{ path: "/w/api", name: "api", branch: "main", changes: 2, unpushed: 0, unreadable: null }],
    });

    expect(["My pull requests", "My issues", "WIPs"].map((label) => tab(host, label).querySelector(".count")?.textContent)).toEqual(["3", "1", "1"]);
    expect([...host.querySelectorAll('[role="group"][aria-label]')].map((group) => group.getAttribute("aria-label"))).toEqual(["Waiting for your review · 1", "Authored by you · 2"]);
    expect(rows(host)[0]).toBe("Pull request #418: Retry login, platform/api, fix/ABC-142-retry to main, Review requested");
    expect(host.textContent).toContain("Draft");
    expect(host.querySelector(".lp-row .chip.key .mono")?.textContent).toBe("ABC-142");
    expect(sourceLine(host, "gitlab.corp-a.com")).toMatch(/^gitlab\.corp-a\.com · updated \w+ ago · 2 pull requests$/);
    expect(sourceLine(host, "bitbucket.corp-b.com")).toMatch(/^bitbucket\.corp-b\.com · updated \w+ ago · 1 pull request$/);
  });

  it("ages a pull request's updated time as the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T06:00:20Z"));
      const { host } = await mount({ platform: [gitlab], pulls: { c1: [pull("c1", 418, "Retry login")] } });
      expect(host.textContent).toContain("by nok · 20s ago");

      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await flush();

      expect(host.textContent).toContain("by nok · 2h ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters by the search field and by the source Select", async () => {
    const { host } = await mount({
      platform: [gitlab, bitbucket],
      pulls: { c1: [pull("c1", 418, "Retry login")], c2: [pull("c2", 77, "Pin image", { connection_id: "c2" })] },
    });

    type(host.querySelector('input[aria-label="Search Launchpad"]'), "pin");
    await flush();
    expect(rows(host)).toHaveLength(1);
    expect(rows(host)[0]).toContain("#77");

    type(host.querySelector('input[aria-label="Search Launchpad"]'), "");
    await choose(host, "Source", "bitbucket.corp-b.comBitbucket");
    expect(rows(host)).toHaveLength(1);
    expect(rows(host)[0]).toContain("#77");

    type(host.querySelector('input[aria-label="Search Launchpad"]'), "zzz");
    await flush();
    expect(host.textContent).toContain("No pull request matches the search.");
  });

  it("states a failing source in text beside the sources that answered, with Retry and Edit connection for a refused token", async () => {
    const { host, app, calls } = await mount({
      platform: [gitlab, bitbucket],
      pulls: { c1: { kind: "auth_failed", message: "Authentication failed for gitlab.corp-a.com" }, c2: [pull("c2", 77, "Pin image", { connection_id: "c2" })] },
    });
    const settings = vi.spyOn(app, "openSettings").mockImplementation(() => undefined);

    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("gitlab.corp-a.com could not be read");
    expect(alert.textContent).toContain("Authentication failed for gitlab.corp-a.com");
    expect(rows(host)).toHaveLength(1);
    expect(sourceLine(host, "bitbucket.corp-b.com")).toContain("1 pull request");
    expect(sourceLine(host, "gitlab.corp-a.com")).not.toContain("updated");
    buttonNamed(alert, "Edit connection")?.click();
    expect(settings).toHaveBeenCalledWith("platforms");
    const before = calls.filter((call) => call.cmd === "platform_my_pulls").length;
    buttonNamed(alert, "Retry")?.click();
    await flush(60);
    expect(calls.filter((call) => call.cmd === "platform_my_pulls").length).toBeGreaterThan(before);
  });

  it("opens the repository tab and then the pull request when the repository is cloned here, and the browser otherwise", async () => {
    const { host, app } = await mount({
      platform: [gitlab],
      pulls: { c1: [pull("c1", 418, "Retry login", { local_path: "/w/api" }), pull("c1", 7, "Elsewhere")] },
    });
    const open = vi.spyOn(app, "openRepository").mockResolvedValue(true);
    const browser = vi.spyOn(window, "open").mockReturnValue(null);
    const opener = (label: string) => [...host.querySelectorAll<HTMLElement>(".lp-open")].find((row) => row.getAttribute("aria-label")?.includes(label)) as HTMLElement;

    opener("#418").click();
    await flush();
    opener("#7").click();
    await flush();

    expect(open).toHaveBeenCalledWith("/w/api");
    expect(takePullInspector("/w/api")).toBe(418);
    expect(browser).toHaveBeenCalledWith("https://host/pr/7", "_blank", "noopener,noreferrer");
  });
});

const count = (host: ParentNode, label: string) => tab(host, label).querySelector(".count")?.textContent;

describe("Launchpad paged lists (S44)", () => {
  it("counts the true total of a capped list and says Showing 1,000 of <total>", async () => {
    const { host } = await mount({
      platform: [gitlab, bitbucket],
      pulls: { c1: [pull("c1", 418, "Retry login")], c2: [pull("c2", 77, "Pin image", { connection_id: "c2" })] },
      pages: { c1: { total: 1500, capped: true } },
    });

    expect(count(host, "My pull requests")).toBe("1501");
    expect(sourceLine(host, "gitlab.corp-a.com")).toMatch(/· 1500 pull requests · Showing 1,000 of 1,500$/);
    expect(sourceLine(host, "bitbucket.corp-b.com")).not.toContain("Showing");
  });

  it("says Showing the first 1,000 when a capped list has no total, and counts what was returned", async () => {
    const { host } = await mount({ platform: [gitlab], pulls: { c1: [pull("c1", 418, "Retry login"), pull("c1", 421, "Document proxy")] }, pages: { c1: { total: null, capped: true } } });

    expect(count(host, "My pull requests")).toBe("2");
    expect(sourceLine(host, "gitlab.corp-a.com")).toMatch(/· 2 pull requests · Showing the first 1,000$/);
  });

  it("counts the true total of Jira issues and states the cap per site", async () => {
    const capped = await mount({ jira: [site], issues: [issue("ABC-155", "Switcher")], issuePage: { total: 1200, capped: true } });
    tab(capped.host, "My issues").click();
    await flush();

    expect(count(capped.host, "My issues")).toBe("1200");
    expect(sourceLine(capped.host, "your-site.atlassian.net")).toMatch(/· 1200 issues · Showing 1,000 of 1,200$/);
    capped.dispose();
    dispose = undefined;
    document.body.innerHTML = "";

    const unknown = await mount({ jira: [site], issues: [issue("ABC-155", "Switcher")], issuePage: { total: null, capped: true } });
    tab(unknown.host, "My issues").click();
    await flush();

    expect(count(unknown.host, "My issues")).toBe("1");
    expect(sourceLine(unknown.host, "your-site.atlassian.net")).toMatch(/· 1 issue · Showing the first 1,000$/);
  });
});

describe("Launchpad update times (S41)", () => {
  const T = "2026-10-01T06:00:00Z";

  it("has no combined update time and states each source's own, ageing as the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date(T));
      const { host } = await mount({ platform: [gitlab], pulls: { c1: [pull("c1", 418, "Retry login")] }, wips: [] });

      expect(host.querySelector(".lp-head")?.textContent).not.toContain("Updated");
      expect(sourceLine(host, "gitlab.corp-a.com")).toBe("gitlab.corp-a.com · updated 0s ago · 1 pull request");

      vi.advanceTimersByTime(5 * 60 * 1000);
      await flush();

      expect(sourceLine(host, "gitlab.corp-a.com")).toBe("gitlab.corp-a.com · updated 5m ago · 1 pull request");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows a source that failed to refresh as fresh because another source succeeded", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date(T));
      const data: Data = { platform: [gitlab, bitbucket], pulls: { c1: [pull("c1", 418, "Retry login")], c2: [pull("c2", 77, "Pin image", { connection_id: "c2" })] } };
      const { host } = await mount(data);
      vi.advanceTimersByTime(10 * 60 * 1000);
      await flush();
      data.pulls = { c1: { kind: "auth_failed", message: "Authentication failed for gitlab.corp-a.com" }, c2: [pull("c2", 77, "Pin image", { connection_id: "c2" })] };

      host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')?.click();
      await flush(80);

      expect(sourceLine(host, "bitbucket.corp-b.com")).toBe("bitbucket.corp-b.com · updated 0s ago · 1 pull request");
      expect(sourceLine(host, "gitlab.corp-a.com")).toBe("gitlab.corp-a.com · updated 10m ago · could not be read: Authentication failed for gitlab.corp-a.com");
    } finally {
      vi.useRealTimers();
    }
  });

  it("states the update time of the recent repositories on the WIPs tab", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date(T));
      const { host } = await mount({ wips: [{ path: "/w/api", name: "api", branch: "main", changes: 2, unpushed: 0, unreadable: null }] });
      tab(host, "WIPs").click();
      await flush();
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await flush();

      expect(sourceLine(host, "Recent repositories")).toBe("Recent repositories · updated 2h ago · 1 repository");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Launchpad issues and WIPs", () => {
  it("offers Connect Jira in text when no site is connected", async () => {
    const { host, app } = await mount({});
    const settings = vi.spyOn(app, "openSettings").mockImplementation(() => undefined);

    tab(host, "My issues").click();
    await flush();

    expect(host.textContent).toContain("No Jira site is connected");
    buttonNamed(host, "Connect Jira")?.click();
    expect(settings).toHaveBeenCalledWith("jira");
  });

  it("lists assigned issues with the status word and opens one in the browser", async () => {
    const { host } = await mount({ jira: [site], issues: [issue("ABC-155", "Show the switcher")] });
    const browser = vi.spyOn(window, "open").mockReturnValue(null);

    tab(host, "My issues").click();
    await flush();

    expect(rows(host)).toEqual(["ABC-155 Show the switcher, In Progress"]);
    expect(sourceLine(host, "your-site.atlassian.net")).toMatch(/^your-site\.atlassian\.net · updated \w+ ago · 1 issue$/);
    (host.querySelector(".lp-open") as HTMLElement).click();
    expect(browser).toHaveBeenCalledWith("https://your-site.atlassian.net/browse/ABC-155", "_blank", "noopener,noreferrer");
  });

  it("says no open issues are assigned when the site has none", async () => {
    const { host } = await mount({ jira: [site], issues: [] });

    tab(host, "My issues").click();
    await flush();

    expect(host.textContent).toContain("No open issues assigned to you");
  });

  it("lists work in progress with what is unfinished and opens the repository", async () => {
    const { host, app } = await mount({ wips: [{ path: "/w/api", name: "api", branch: "main", changes: 2, unpushed: 1, unreadable: null }] });
    const open = vi.spyOn(app, "openRepository").mockResolvedValue(true);

    tab(host, "WIPs").click();
    await flush();

    expect(rows(host)).toEqual(["Open api, 2 uncommitted changes · 1 unpushed commit"]);
    (host.querySelector(".lp-open") as HTMLElement).click();
    expect(open).toHaveBeenCalledWith("/w/api");
  });

  it("lists a repository whose status could not be read with the reason", async () => {
    const { host } = await mount({ wips: [{ path: "/w/api", name: "api", branch: null, changes: 0, unpushed: 0, unreadable: "index file smaller than expected" }] });

    tab(host, "WIPs").click();
    await flush();

    expect(rows(host)).toEqual(["Open api, Could not read status: index file smaller than expected"]);
    expect(host.textContent).toContain("Could not read status: index file smaller than expected");
  });

  it("says nothing is unfinished when there is no work in progress", async () => {
    const { host } = await mount({});

    tab(host, "WIPs").click();
    await flush();

    expect(host.textContent).toContain("No recent repository has uncommitted changes or unpushed commits.");
    expect(host.querySelector('button[aria-label="Source"]')).toBeNull();
  });

  it("refreshes every source and never writes", async () => {
    const { host, calls } = await mount({ platform: [gitlab], pulls: { c1: [] }, jira: [site] });
    const before = calls.length;

    host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')?.click();
    await flush(80);

    expect(calls.length).toBeGreaterThan(before);
    expect(calls.every((call) => /^(platform_connections_list|platform_my_pulls|jira_connections_list|jira_my_issues|launchpad_wips|repositories_list|recent_statuses|jira_issue_keys|jira_issues_lookup)$/.test(call.cmd))).toBe(true);
  });
});

const status = (path: string, overrides: Partial<RecentStatus> = {}): RecentStatus => ({
  path,
  exists: true,
  branch: "main",
  unborn: false,
  ahead_behind: null,
  counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
  worktrees: 1,
  unreadable: null,
  ...overrides,
});

const managed: Repositories = {
  folders: [{ path: "/u/Code", depth: 2, scanned_at: 1, repos: ["/u/Code/web", "/u/Code/api", "/u/Code/old"], skipped: [] }],
  repos: [
    { path: "/u/Code/web", folder: "/u/Code", opened_at: 100 },
    { path: "/u/dotfiles", folder: null, opened_at: 50 },
    { path: "/u/Code/api", folder: "/u/Code", opened_at: null },
    { path: "/u/Code/old", folder: "/u/Code", opened_at: null },
  ],
};

const managedStatuses = [
  status("/u/Code/web", { branch: "feature/login", counts: { modified: 2, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, ahead_behind: { ahead: 0, behind: 3 } }),
  status("/u/dotfiles", { ahead_behind: { ahead: 1, behind: 0 } }),
  status("/u/Code/api", { unreadable: "permission denied" }),
  status("/u/Code/old", { exists: false, branch: null, counts: null }),
];

const repoRows = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>('.repo-list [role="option"]')];
const actions = (host: ParentNode) => host.querySelector<HTMLElement>('.repo-actbar[role="toolbar"]');

describe("Launchpad repositories (S41, S46)", () => {
  it("opens on Repositories: a table grouped by scanned folder with each status in words", async () => {
    const { host } = await mount({ repositories: managed, statuses: managedStatuses, tab: "Repositories" });

    expect(tab(host, "Repositories").getAttribute("aria-selected")).toBe("true");
    expect(tab(host, "Repositories").querySelector(".count")?.textContent).toBe("4");
    expect(host.querySelector(".repo-head")?.textContent).toBe("RepositoryBranchStatusLast opened");
    expect([...host.querySelectorAll('.repo-list [role="group"]')].map((group) => group.getAttribute("aria-label"))).toEqual(["/u/Code · 3", "Added when you opened them · 1"]);
    expect(repoRows(host).map((row) => row.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/^web, feature\/login, 2 changes, 3 to pull, Opened \w+ ago$/),
      "api, no branch, Status unavailable, Never opened",
      "old, no branch, Not found, Never opened",
      expect.stringMatching(/^dotfiles, main, 1 to push, Opened \w+ ago$/),
    ]);
    expect(host.querySelector('.fold-chips [role="group"], .fold-chips')?.textContent).toContain("/u/Code");
  });

  it("acts on the selected row from the bar under the table, and offers no Open for a missing repository", async () => {
    const { host, calls } = await mount({ repositories: managed, statuses: managedStatuses, tab: "Repositories" });

    expect(actions(host)?.getAttribute("aria-label")).toBe("Actions for web");
    buttonNamed(actions(host) as HTMLElement, "Reveal in Finder")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "open_path")?.args).toEqual({ path: "/u/Code/web", with: "finder" });

    repoRows(host)[2]?.click();
    await flush();
    expect(actions(host)?.getAttribute("aria-label")).toBe("Actions for old");
    expect(actions(host)?.textContent).toContain("Not found at this path");
    expect(buttonNamed(actions(host) as HTMLElement, "Open")).toBeUndefined();
  });

  it("moves with the arrow keys and opens the selected repository with Enter", async () => {
    const { host, app } = await mount({ repositories: managed, statuses: managedStatuses, tab: "Repositories" });
    const opened = vi.spyOn(app, "openRepository").mockResolvedValue(true);
    const list = host.querySelector<HTMLElement>('.repo-list[role="listbox"]') as HTMLElement;

    list.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await flush();
    expect(actions(host)?.getAttribute("aria-label")).toBe("Actions for dotfiles");
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(opened).toHaveBeenCalledWith("/u/dotfiles");
  });

  it("searches names, paths, and branches", async () => {
    const { host } = await mount({ repositories: managed, statuses: managedStatuses, tab: "Repositories" });

    type(host.querySelector('input[aria-label="Search repositories"]'), "login");
    await flush();
    expect(repoRows(host).map((row) => row.querySelector("strong")?.textContent)).toEqual(["web"]);
    type(host.querySelector('input[aria-label="Search repositories"]'), "zzz");
    await flush();
    expect(host.textContent).toContain("No repository matches “zzz”");
  });

  it("removes a repository from the list, says nothing on disk changed, and puts it back with Undo", async () => {
    const without: Repositories = { ...managed, repos: managed.repos.filter((repo) => repo.path !== "/u/Code/web") };
    const { host, calls } = await mount({
      repositories: managed,
      statuses: managedStatuses,
      tab: "Repositories",
      answer: (call) => (call.cmd === "repository_remove" ? { removed: managed.repos[0], repositories: without } : call.cmd === "repository_restore" ? managed : undefined),
    });

    buttonNamed(actions(host) as HTMLElement, "Remove from list")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "repository_remove")?.args).toEqual({ path: "/u/Code/web" });
    expect(host.querySelector(".list-change")?.textContent).toContain("Removed web from the list. Nothing on disk changed. Rescans of /u/Code skip it.");
    expect(repoRows(host)).toHaveLength(3);

    buttonNamed(host.querySelector(".list-change") as HTMLElement, "Undo")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "repository_restore")?.args).toEqual({ repo: managed.repos[0] });
    expect(repoRows(host)).toHaveLength(4);
    expect(host.querySelector(".list-change")).toBeNull();
  });

  it("rescans and stops scanning a folder from its chip, with Undo for Stop scanning", async () => {
    const stopped: Repositories = { folders: [], repos: [managed.repos[0], managed.repos[1]].map((repo) => ({ ...repo, folder: null })) as Repositories["repos"] };
    const { host, calls } = await mount({
      repositories: managed,
      statuses: managedStatuses,
      tab: "Repositories",
      answer: (call) =>
        call.cmd === "scan_folder_rescan" ? { added: ["/u/Code/cli"], repositories: managed } : call.cmd === "scan_folder_remove" ? { folder: managed.folders[0], repositories: stopped } : call.cmd === "scan_folder_save" ? managed : undefined,
    });

    host.querySelector<HTMLButtonElement>('button[aria-label="Rescan /u/Code"]')?.click();
    await flush(40);
    expect(host.querySelector(".list-change")?.textContent).toContain("Found 1 new repository in /u/Code: cli.");

    host.querySelector<HTMLButtonElement>('button[aria-label="Stop scanning /u/Code"]')?.click();
    await flush(40);
    expect(host.querySelector(".list-change")?.textContent).toContain("Stopped scanning /u/Code. Took 2 repositories off the list; kept 1 repository you opened. Nothing on disk changed.");
    buttonNamed(host.querySelector(".list-change") as HTMLElement, "Undo")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "scan_folder_save")?.args).toEqual({ folder: managed.folders[0] });
  });

  it("offers Add folder… when nothing is listed yet and opens the scan dialog", async () => {
    const { host } = await mount({ tab: "Repositories" });

    expect(host.textContent).toContain("No repositories yet");
    buttonNamed(host.querySelector(".lp-empty-box") as HTMLElement, "Add folder…")?.click();
    await flush();
    expect(document.querySelector('[role="dialog"] h3')?.textContent).toBe("Add a folder to scan");
  });
});

describe("Launchpad as the landing screen (S41)", () => {
  it("offers Open…, Clone…, and Create… in its header", async () => {
    const { host, app, calls } = await mount({ tab: "Repositories", answer: (call) => (call.cmd === "plugin:dialog|open" ? "/u/picked" : undefined) });
    const opened = vi.spyOn(app, "openRepository").mockResolvedValue(true);
    const head = host.querySelector(".lp-head") as HTMLElement;

    buttonNamed(head, "Clone…")?.click();
    expect(app.entryDialog()).toBe("clone");
    buttonNamed(head, "Create…")?.click();
    expect(app.entryDialog()).toBe("create");
    buttonNamed(head, "Open…")?.click();
    await flush(40);
    expect(calls.some((call) => call.cmd === "plugin:dialog|open")).toBe(true);
    expect(opened).toHaveBeenCalledWith("/u/picked");
  });
});
