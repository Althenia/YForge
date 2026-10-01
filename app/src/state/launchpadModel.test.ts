import { describe, expect, it } from "vitest";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { LaunchpadPull } from "../ipc/bindings/LaunchpadPull";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import type { JiraSource } from "./jiraIssues";
import {
  ALL_SOURCES,
  countText,
  groupPulls,
  issueSourceLines,
  LAUNCHPAD_TABS,
  pullBadge,
  pullSourceLines,
  sourceChoices,
  sourceName,
  visibleIssues,
  visiblePulls,
  visibleWips,
  wipSourceLine,
  wipSummary,
  type PullSource,
} from "./launchpadModel";

const connection = (id: string, overrides: Partial<PlatformConnection> = {}): PlatformConnection => ({ id, kind: "gitlab", host: "gitlab.corp-a.com", name: "GitLab", insecure_tls: false, created_at: 1, ...overrides });

const pull = (number: number, overrides: Partial<LaunchpadPull> = {}, title = "Retry login"): LaunchpadPull => ({
  connection_id: "c1",
  repo: { owner: "platform", repo: "api" },
  role: "authored",
  draft: false,
  local_path: null,
  pull: { number, title, body: "", state: "open", source_ref: "fix/retry", target_ref: "main", author: "nok", created_at: "", updated_at: "", mergeable: null, web_url: "https://x/pr" },
  ...overrides,
});

const NOW = 1_000_000;

const source = (id: string, pulls: LaunchpadPull[], overrides: Partial<PullSource> = {}): PullSource => ({ connection: connection(id), pulls, total: pulls.length, capped: false, loading: false, failure: undefined, updatedAt: NOW - 90, ...overrides });

describe("Launchpad tabs", () => {
  it("names the three lists", () => {
    expect(LAUNCHPAD_TABS.map((tab) => [tab.id, tab.label])).toEqual([
      ["pulls", "My pull requests"],
      ["issues", "My issues"],
      ["wips", "WIPs"],
    ]);
  });

  it("counts rows and shows an ellipsis only while nothing has loaded yet", () => {
    expect(countText(0, true)).toBe("…");
    expect(countText(3, true)).toBe("3");
    expect(countText(0, false)).toBe("0");
  });
});

describe("pull request rows", () => {
  const sources = [source("c1", [pull(418, { role: "review_requested" }), pull(7, {}, "Pin the image")]), source("c2", [pull(77, { connection_id: "c2", repo: { owner: "ops", repo: "ci" } }, "Document proxy")])];

  it("filters by title, number with or without #, repository, and branch", () => {
    expect(visiblePulls(sources, "", ALL_SOURCES).map((row) => row.pull.number)).toEqual([418, 7, 77]);
    expect(visiblePulls(sources, "pin", ALL_SOURCES).map((row) => row.pull.number)).toEqual([7]);
    expect(visiblePulls(sources, "#418", ALL_SOURCES).map((row) => row.pull.number)).toEqual([418]);
    expect(visiblePulls(sources, "ops/ci", ALL_SOURCES).map((row) => row.pull.number)).toEqual([77]);
    expect(visiblePulls(sources, "FIX/RETRY", ALL_SOURCES).map((row) => row.pull.number)).toEqual([418, 7, 77]);
    expect(visiblePulls(sources, "nothing", ALL_SOURCES)).toEqual([]);
  });

  it("narrows by connection", () => {
    expect(visiblePulls(sources, "", "c2").map((row) => row.pull.number)).toEqual([77]);
  });

  it("groups review requests before authored pull requests with their counts and drops empty groups", () => {
    expect(groupPulls(visiblePulls(sources, "", ALL_SOURCES)).map((group) => [group.heading, group.pulls.length])).toEqual([
      ["Waiting for your review · 1", 1],
      ["Authored by you · 2", 2],
    ]);
    expect(groupPulls([])).toEqual([]);
  });

  it("says Review requested, Draft, or Open in words", () => {
    expect(pullBadge(pull(1, { role: "review_requested" })).label).toBe("Review requested");
    expect(pullBadge(pull(1, { draft: true })).label).toBe("Draft");
    expect(pullBadge(pull(1))).toMatchObject({ label: "Open", icon: "pullrequest" });
  });
});

describe("per-source status", () => {
  it("states reading, the count read, or the failure for every source in text, each with its own update time", () => {
    const lines = pullSourceLines(
      [
        source("c1", [], { loading: true, updatedAt: 0 }),
        source("c2", [pull(1)], { connection: connection("c2", { host: "bitbucket.corp-b.com", kind: "bitbucket", name: "Bitbucket" }) }),
        source("c3", [], { failure: { message: "Authentication failed for gitlab.corp-a.com", action: "edit_connection" }, connection: connection("c3", { name: "Work" }), updatedAt: 0 }),
      ],
      NOW,
    );

    expect(lines.map((line) => [line.state, line.text])).toEqual([
      ["loading", "gitlab.corp-a.com · reading …"],
      ["done", "bitbucket.corp-b.com · updated 1m ago · 1 pull request"],
      ["failed", "gitlab.corp-a.com (Work) · could not be read: Authentication failed for gitlab.corp-a.com"],
    ]);
    expect(sourceName(connection("x", { kind: "github", host: "github.com", name: "GitHub" }))).toBe("github.com");
  });

  it("keeps a failed or refreshing source's own age, never another source's", () => {
    const lines = pullSourceLines(
      [
        source("c1", [pull(1)], { failure: { message: "timed out", action: undefined }, updatedAt: NOW - 3 * 3600 }),
        source("c2", [pull(2)], { loading: true, updatedAt: NOW - 20 }),
        source("c3", [pull(3)], { updatedAt: NOW }),
      ],
      NOW,
    );

    expect(lines.map((line) => line.text)).toEqual([
      "gitlab.corp-a.com · updated 3h ago · could not be read: timed out",
      "gitlab.corp-a.com · updated 20s ago · reading …",
      "gitlab.corp-a.com · updated 0s ago · 1 pull request",
    ]);
  });

  it("counts the true total and states the cap in words", () => {
    const lines = pullSourceLines([source("c1", [pull(1)], { total: 1500, capped: true }), source("c2", [pull(2)], { total: null, capped: true }), source("c3", [pull(3)], { total: 1, capped: false })], NOW);

    expect(lines.map((line) => line.text.replace(/ · updated \w+ ago/, ""))).toEqual([
      "gitlab.corp-a.com · 1500 pull requests · Showing 1,000 of 1,500",
      "gitlab.corp-a.com · 1 pull request · Showing the first 1,000",
      "gitlab.corp-a.com · 1 pull request",
    ]);
  });

  it("does the same for Jira sites", () => {
    const jira = (id: string, host: string): JiraConnection => ({ id, kind: "cloud", site: `https://${host}`, host, email: "a@b.c", display_name: "V", projects: [], created_at: 1 });
    const page = { total: null, capped: false };
    const sources: JiraSource[] = [
      { connection: jira("j1", "your-site.atlassian.net"), issues: [], ...page, loading: true, failure: undefined, updatedAt: 0 },
      { connection: jira("j2", "jira.corp"), issues: [{} as JiraIssue, {} as JiraIssue], total: 2, capped: false, loading: false, failure: undefined, updatedAt: NOW - 30 },
      { connection: jira("j3", "jira.down"), issues: [], ...page, loading: false, failure: { message: "Could not reach jira.down: could not connect" }, updatedAt: 0 },
      { connection: jira("j4", "jira.big"), issues: [{} as JiraIssue], total: 1200, capped: true, loading: false, failure: undefined, updatedAt: NOW - 30 },
    ];

    expect(issueSourceLines(sources, NOW).map((line) => line.text)).toEqual([
      "your-site.atlassian.net · reading …",
      "jira.corp · updated 30s ago · 2 issues",
      "jira.down · could not be read: Could not reach jira.down: could not connect",
      "jira.big · updated 30s ago · 1200 issues · Showing 1,000 of 1,200",
    ]);
  });

  it("states the recent repositories as their own source", () => {
    expect(wipSourceLine({ count: 1, loading: false, failure: undefined, updatedAt: NOW - 7200 }, NOW).text).toBe("Recent repositories · updated 2h ago · 1 repository");
    expect(wipSourceLine({ count: 0, loading: false, failure: undefined, updatedAt: NOW }, NOW).text).toBe("Recent repositories · updated 0s ago · 0 repositories");
    expect(wipSourceLine({ count: 0, loading: false, failure: { message: "denied" }, updatedAt: 0 }, NOW)).toMatchObject({ state: "failed", text: "Recent repositories · could not be read: denied" });
  });
});

describe("issues and work in progress", () => {
  const issue = (key: string, summary: string): JiraIssue => ({ key, summary, status: "To Do", status_category: "todo", issue_type: "Task", project: key.split("-")[0] as string, assignee: "V", updated_at: "", web_url: "", connection_id: "j1" });
  const jira = (id: string, issues: JiraIssue[]): JiraSource => ({ connection: { id, kind: "cloud", site: "", host: `${id}.host`, email: "a@b.c", display_name: "V", projects: [], created_at: 1 }, issues, total: issues.length, capped: false, loading: false, failure: undefined, updatedAt: 0 });

  it("filters issues by key or summary and narrows by site", () => {
    const sources = [jira("j1", [issue("ABC-1", "Retry login")]), jira("j2", [issue("OPS-9", "Proxy")])];

    expect(visibleIssues(sources, "ops-9", ALL_SOURCES).map((row) => row.key)).toEqual(["OPS-9"]);
    expect(visibleIssues(sources, "", "j1").map((row) => row.key)).toEqual(["ABC-1"]);
  });

  it("filters work in progress by repository, path, and branch and says what is unfinished", () => {
    const wips = [
      { path: "/w/yforge", name: "yforge", branch: "feat/hosts", changes: 3, unpushed: 0, unreadable: null },
      { path: "/w/api", name: "api", branch: "main", changes: 0, unpushed: 2, unreadable: null },
    ];

    expect(visibleWips(wips, "feat").map((wip) => wip.name)).toEqual(["yforge"]);
    expect(visibleWips(wips, "/w/api").map((wip) => wip.name)).toEqual(["api"]);
    expect(wipSummary(wips[0] as (typeof wips)[number])).toBe("3 uncommitted changes");
    expect(wipSummary(wips[1] as (typeof wips)[number])).toBe("2 unpushed commits");
    expect(wipSummary({ ...(wips[0] as (typeof wips)[number]), unpushed: 1, changes: 1 })).toBe("1 uncommitted change · 1 unpushed commit");
    expect(wipSummary({ ...(wips[0] as (typeof wips)[number]), changes: 0, unreadable: "index file smaller than expected" })).toBe("Could not read status: index file smaller than expected");
  });

  it("offers All sources plus each connection of the tab, and no filter choices for WIPs", () => {
    const choices = (tab: "pulls" | "issues" | "wips") => sourceChoices(tab, [connection("c1")], [jira("j1", []).connection]).map((choice) => choice.label);

    expect(choices("pulls")).toEqual(["All sources", "gitlab.corp-a.com"]);
    expect(choices("issues")).toEqual(["All sources", "j1.host"]);
    expect(choices("wips")).toEqual(["All sources"]);
  });
});
