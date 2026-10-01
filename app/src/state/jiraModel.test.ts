import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import {
  chipTitle,
  connectionSubtitle,
  filterIssues,
  issueFacts,
  jiraEpochSeconds,
  issueRowLabel,
  JIRA_KINDS,
  jiraFields,
  jiraProblems,
  loadingIssuesText,
  projectsText,
  siteHost,
  statusTone,
  tokenNote,
  uniqueKeys,
} from "./jiraModel";

afterEach(() => clearMocks());

const connection = (overrides: Partial<JiraConnection> = {}): JiraConnection => ({
  id: "j1",
  kind: "cloud",
  site: "https://your-site.atlassian.net",
  host: "your-site.atlassian.net",
  email: "you@example.com",
  display_name: "Sam Lee",
  projects: [
    { key: "ABC", name: "Accounts" },
    { key: "WEB", name: "Website" },
  ],
  created_at: 1,
  ...overrides,
});

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

describe("Jira kinds", () => {
  it("offers Cloud with an email and an API token and Data Center with a personal access token only", () => {
    expect(JIRA_KINDS.map((entry) => [entry.kind, entry.title, entry.tokenLabel])).toEqual([
      ["cloud", "Jira Cloud", "API token"],
      ["data_center", "Jira Data Center", "Personal access token"],
    ]);
    expect(jiraFields("cloud")).toEqual(["site", "email", "token"]);
    expect(jiraFields("data_center")).toEqual(["site", "token"]);
  });

  it("asks the core for each field the kind needs and keeps only the problems", async () => {
    const asked: string[] = [];
    mockIPC((_cmd, args) => {
      const { field, value } = args as { field: string; value: string };
      asked.push(field);
      return field === "site" && value === "" ? "enter the site address" : null;
    }, { shouldMockEvents: true });

    expect(await jiraProblems({ kind: "data_center", site: "", email: "ignored", token: "pat" })).toEqual({ site: "enter the site address" });
    expect(asked).toEqual(["site", "token"]);
  });
});

describe("issue words", () => {
  it("tones the status chip by category and always carries the status word", () => {
    expect(statusTone("todo")).toBe("neutral");
    expect(statusTone("in_progress")).toBe("info");
    expect(statusTone("done")).toBe("ok");
    expect(issueRowLabel(issue())).toBe("ABC-155 Show the account switcher on the login screen, In Progress");
  });

  it("titles a chip with the summary and status, or says the details are unavailable", () => {
    expect(chipTitle("ABC-155", { key: "ABC-155", issue: issue(), failure: null })).toBe("ABC-155 · Show the account switcher on the login screen · In Progress");
    expect(chipTitle("OPS-9", { key: "OPS-9", issue: null, failure: "Could not reach jira.corp: could not connect" })).toBe("OPS-9 · issue details unavailable: Could not reach jira.corp: could not connect");
    expect(chipTitle("OPS-9", { key: "OPS-9", issue: null, failure: null })).toBe("OPS-9 · issue details unavailable");
    expect(chipTitle("OPS-9", undefined)).toBe("OPS-9");
  });

  it("filters issues by key, summary, status, and project case-insensitively", () => {
    const list = [issue(), issue({ key: "OPS-9", summary: "Proxy settings", status: "To Do", project: "OPS" })];
    expect(filterIssues(list, "").length).toBe(2);
    expect(filterIssues(list, "ops-9").map((entry) => entry.key)).toEqual(["OPS-9"]);
    expect(filterIssues(list, "SWITCHER").map((entry) => entry.key)).toEqual(["ABC-155"]);
    expect(filterIssues(list, "to do").map((entry) => entry.key)).toEqual(["OPS-9"]);
  });

  it("collects each key once in first-seen order", () => {
    expect(uniqueKeys([["ABC-1", "OPS-2"], [], ["OPS-2", "ABC-3"]])).toEqual(["ABC-1", "OPS-2", "ABC-3"]);
  });
});

describe("connection words", () => {
  it("says who the connection is signed in as and where the token lives", () => {
    expect(connectionSubtitle(connection())).toBe("Jira Cloud · Connected as Sam Lee");
    expect(connectionSubtitle(connection({ kind: "data_center", email: null, display_name: "you" }))).toBe("Jira Data Center · Connected as you");
    expect(tokenNote(connection())).toBe("API token for you@example.com, stored in the macOS Keychain");
    expect(tokenNote(connection({ kind: "data_center", email: null }))).toBe("Personal access token, stored in the macOS Keychain");
    expect(projectsText(connection())).toBe("ABC Accounts · WEB Website");
    expect(projectsText(connection({ projects: [] }))).toBe("No projects visible to this account");
  });

  it("names at most the first three projects and counts the rest, however many the account sees", () => {
    const projects = Array.from({ length: 1000 }, (_, index) => ({ key: `P${index}`, name: `Project ${index}` }));

    expect(projectsText(connection({ projects: projects.slice(0, 3) }))).toBe("P0 Project 0 · P1 Project 1 · P2 Project 2");
    expect(projectsText(connection({ projects }))).toBe("1000 projects: P0 Project 0 · P1 Project 1 · P2 Project 2 and 997 more");
  });

  it("names the sites an issue list is loading from", () => {
    expect(loadingIssuesText([connection(), connection({ id: "j2", host: "jira.corp-b.internal" })])).toBe("Loading issues from your-site.atlassian.net and jira.corp-b.internal…");
    expect(loadingIssuesText([connection()])).toBe("Loading issues from your-site.atlassian.net…");
  });
});

describe("site address", () => {
  it("shows only the host of what the user typed", () => {
    expect(siteHost(" https://jira.corp-b.internal/jira ")).toBe("jira.corp-b.internal");
    expect(siteHost("your-site.atlassian.net")).toBe("your-site.atlassian.net");
    expect(siteHost("")).toBe("");
  });
});

describe("issue inspector facts", () => {
  it("reads Jira's offset without a colon the way a browser engine can parse it", () => {
    expect(jiraEpochSeconds("2026-10-01T09:30:00.000+0000")).toBe(Date.UTC(2026, 9, 1, 9, 30) / 1000);
    expect(jiraEpochSeconds("2026-10-01T16:30:00.000+0700")).toBe(Date.UTC(2026, 9, 1, 9, 30) / 1000);
    expect(jiraEpochSeconds("2026-10-01T09:30:00Z")).toBe(Date.UTC(2026, 9, 1, 9, 30) / 1000);
    expect(jiraEpochSeconds("")).toBeUndefined();
  });

  it("states the site, project, assignee, and update time in text", () => {
    const connection = { id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "Sam Lee", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 } as JiraConnection;
    const now = Date.UTC(2026, 9, 1, 12, 30) / 1000;

    expect(issueFacts(issue(), connection, now)).toEqual({
      origin: "your-site.atlassian.net · Accounts",
      assignee: "Assigned to you",
      updated: "Updated 3h ago",
    });
    expect(issueFacts(issue({ assignee: null, updated_at: "" }), undefined, now)).toEqual({ origin: "ABC", assignee: "Unassigned", updated: "Update time unknown" });
  });
});
