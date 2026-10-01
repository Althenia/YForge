import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPage } from "./bindings/GraphPage";
import { client, IpcError } from "./client";

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("typed IPC client", () => {
  it("invokes each command by name with its arguments and returns the typed result", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const page: GraphPage = { rows: [], carried: [], total: 0 };
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "app_info") return { app_version: "0.1.0", git_version: "2.55.0" };
      if (cmd === "launch_path") return "/repo";
      if (cmd === "repo_graph") return page;
      return undefined;
    });

    expect(await client.appInfo()).toEqual({ app_version: "0.1.0", git_version: "2.55.0" });
    expect(await client.launchPath()).toBe("/repo");
    expect(await client.repoGraph("/repo", 20, 10)).toEqual(page);
    expect(calls).toEqual([
      { cmd: "app_info", args: {} },
      { cmd: "launch_path", args: {} },
      { cmd: "repo_graph", args: { path: "/repo", offset: 20, limit: 10 } },
    ]);
  });

  it("sends the repository path to repo_open", async () => {
    let received: unknown;
    mockIPC((_cmd, args) => {
      received = args;
      return undefined;
    });

    await client.repoOpen("/some/repo");

    expect(received).toEqual({ path: "/some/repo" });
  });

  it("invokes every working-tree command by name with its arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    const hunk = { old_start: 1, old_lines: 1, new_start: 1, new_lines: 1, heading: "", lines: [] };

    await client.diffFile("/r", "a.txt", "staged");
    await client.diffFile("/r", "a.txt", "unstaged", true);
    await client.stageFiles("/r", ["a.txt"]);
    await client.unstageFiles("/r", ["a.txt"]);
    await client.stageAll("/r");
    await client.unstageAll("/r");
    await client.discardFiles("/r", ["a.txt"]);
    await client.stageHunk("/r", "a.txt", hunk);
    await client.unstageHunk("/r", "a.txt", hunk);
    await client.discardHunk("/r", "a.txt", hunk);
    await client.stageLines("/r", "a.txt", hunk, [1, 2]);
    await client.unstageLines("/r", "a.txt", hunk, [1]);
    await client.discardLines("/r", "a.txt", hunk, [3]);
    await client.editHeadMessage("/r", "abc1234", "New subject", "New body");
    await client.commit("/r", "Summary", "Body", true);
    await client.amendInfo("/r");
    await client.commitDetails("/r", "abc1234");
    await client.commitFileDiff("/r", "abc1234", "a.txt");
    await client.repoWatch("/r");

    expect(calls).toEqual([
      { cmd: "diff_file", args: { path: "/r", file: "a.txt", area: "staged" } },
      { cmd: "diff_file", args: { path: "/r", file: "a.txt", area: "unstaged", ignoreWhitespace: true } },
      { cmd: "stage_files", args: { path: "/r", files: ["a.txt"] } },
      { cmd: "unstage_files", args: { path: "/r", files: ["a.txt"] } },
      { cmd: "stage_all", args: { path: "/r" } },
      { cmd: "unstage_all", args: { path: "/r" } },
      { cmd: "discard_files", args: { path: "/r", files: ["a.txt"] } },
      { cmd: "stage_hunk", args: { path: "/r", file: "a.txt", hunk } },
      { cmd: "unstage_hunk", args: { path: "/r", file: "a.txt", hunk } },
      { cmd: "discard_hunk", args: { path: "/r", file: "a.txt", hunk } },
      { cmd: "stage_lines", args: { path: "/r", file: "a.txt", hunk, lines: [1, 2] } },
      { cmd: "unstage_lines", args: { path: "/r", file: "a.txt", hunk, lines: [1] } },
      { cmd: "discard_lines", args: { path: "/r", file: "a.txt", hunk, lines: [3] } },
      { cmd: "edit_head_message", args: { path: "/r", sha: "abc1234", summary: "New subject", description: "New body" } },
      { cmd: "commit", args: { path: "/r", summary: "Summary", description: "Body", amend: true } },
      { cmd: "amend_info", args: { path: "/r" } },
      { cmd: "commit_details", args: { path: "/r", sha: "abc1234" } },
      { cmd: "commit_file_diff", args: { path: "/r", sha: "abc1234", file: "a.txt" } },
      { cmd: "repo_watch", args: { path: "/r" } },
    ]);
  });

  it("invokes every branch, stash, sync, and operation command by name with its arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    const lease = { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "abc1234" };

    await client.checkout("/r", { kind: "tag", name: "v1" }, true);
    await client.checkBranchName("/r", "topic");
    await client.createBranch("/r", "topic", "abc1234", false);
    await client.renameBranch("/r", "topic", "topic2");
    await client.branchDeletePreview("/r", "topic2");
    await client.deleteBranch("/r", "topic2", true);
    await client.stashPush("/r", "wip", true);
    await client.stashApply("/r", 1, "s1");
    await client.stashPop("/r", 1, "s1");
    await client.stashDrop("/r", 1, "s1");
    await client.deleteBranches("/r", ["a", "b"], ["b"]);
    await client.dropStashes("/r", [{ index: 2, sha: "s2" }]);
    await client.fetch("/r", "op-1", false);
    await client.pull("/r", "op-2", "rebase");
    await client.push("/r", "op-3");
    await client.pushPlan("/r");
    await client.pushForce("/r", "op-4", lease);
    await client.operationCancel("op-1");
    await client.operationContinue("/r", null);
    await client.operationSkip("/r");
    await client.operationAbort("/r");
    await client.markResolved("/r", ["a.txt"]);

    expect(calls).toEqual([
      { cmd: "checkout", args: { path: "/r", target: { kind: "tag", name: "v1" }, stash: true } },
      { cmd: "check_branch_name", args: { path: "/r", name: "topic" } },
      { cmd: "create_branch", args: { path: "/r", name: "topic", at: "abc1234", checkout: false } },
      { cmd: "rename_branch", args: { path: "/r", from: "topic", to: "topic2" } },
      { cmd: "branch_delete_preview", args: { path: "/r", name: "topic2" } },
      { cmd: "delete_branch", args: { path: "/r", name: "topic2", force: true } },
      { cmd: "stash_push", args: { path: "/r", message: "wip", untracked: true } },
      { cmd: "stash_apply", args: { path: "/r", index: 1, sha: "s1" } },
      { cmd: "stash_pop", args: { path: "/r", index: 1, sha: "s1" } },
      { cmd: "stash_drop", args: { path: "/r", index: 1, sha: "s1" } },
      { cmd: "delete_branches", args: { path: "/r", names: ["a", "b"], forced: ["b"] } },
      { cmd: "drop_stashes", args: { path: "/r", targets: [{ index: 2, sha: "s2" }] } },
      { cmd: "fetch", args: { path: "/r", id: "op-1", prune: false } },
      { cmd: "pull", args: { path: "/r", id: "op-2", mode: "rebase" } },
      { cmd: "push", args: { path: "/r", id: "op-3" } },
      { cmd: "push_plan", args: { path: "/r" } },
      { cmd: "push_force", args: { path: "/r", id: "op-4", lease } },
      { cmd: "operation_cancel", args: { id: "op-1" } },
      { cmd: "operation_continue", args: { path: "/r", message: null } },
      { cmd: "operation_skip", args: { path: "/r" } },
      { cmd: "operation_abort", args: { path: "/r" } },
      { cmd: "mark_resolved", args: { path: "/r", files: ["a.txt"] } },
    ]);
  });

  it("sends the integration, tag, and conflict commands with their arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return undefined;
    });

    await client.integrationPreview("/r", null, "topic");
    await client.merge("/r", "topic", "merge_commit");
    await client.rebase("/r", "origin/main");
    await client.fastForward("/r", "main", "topic");
    await client.cherryPick("/r", "abc1234");
    await client.revert("/r", "abc1234");
    await client.reset("/r", "abc1234", "hard");
    await client.createTag("/r", "v1", "abc1234", null);
    await client.deleteTag("/r", "v1");
    await client.deleteTags("/r", ["v1", "v2"]);
    await client.pushTag("/r", "op-5", "origin", "v1");
    await client.deleteRemoteTag("/r", "op-6", "origin", "v1");
    await client.conflictFile("/r", "a.txt");
    await client.conflictResolve("/r", "a.txt", "x\n");
    await client.conflictTakeSide("/r", "a.txt", "incoming");
    await client.conflictReset("/r", "a.txt");

    expect(calls).toEqual([
      { cmd: "integration_preview", args: { path: "/r", base: null, other: "topic" } },
      { cmd: "merge", args: { path: "/r", source: "topic", mode: "merge_commit" } },
      { cmd: "rebase", args: { path: "/r", onto: "origin/main" } },
      { cmd: "fast_forward", args: { path: "/r", branch: "main", target: "topic" } },
      { cmd: "cherry_pick", args: { path: "/r", sha: "abc1234" } },
      { cmd: "revert", args: { path: "/r", sha: "abc1234" } },
      { cmd: "reset", args: { path: "/r", target: "abc1234", mode: "hard" } },
      { cmd: "create_tag", args: { path: "/r", name: "v1", at: "abc1234", message: null } },
      { cmd: "delete_tag", args: { path: "/r", name: "v1" } },
      { cmd: "delete_tags", args: { path: "/r", names: ["v1", "v2"] } },
      { cmd: "push_tag", args: { path: "/r", id: "op-5", remote: "origin", name: "v1" } },
      { cmd: "delete_remote_tag", args: { path: "/r", id: "op-6", remote: "origin", name: "v1" } },
      { cmd: "conflict_file", args: { path: "/r", file: "a.txt" } },
      { cmd: "conflict_resolve", args: { path: "/r", file: "a.txt", content: "x\n" } },
      { cmd: "conflict_take_side", args: { path: "/r", file: "a.txt", side: "incoming" } },
      { cmd: "conflict_reset", args: { path: "/r", file: "a.txt" } },
    ]);
  });

  it("delivers operation-progress payloads with the operation id until unlistened", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: Array<[string, string, number | null]> = [];
    const unlisten = await client.onOperationProgress((progress) => received.push([progress.id, progress.phase, progress.percent]));

    await emit("operation-progress", { id: "op-1", phase: "Receiving objects", percent: 42 });
    await emit("operation-progress", { id: "op-1", phase: "Fetching origin", percent: null });
    unlisten();
    await emit("operation-progress", { id: "op-2", phase: "later", percent: 1 });

    expect(received).toEqual([
      ["op-1", "Receiving objects", 42],
      ["op-1", "Fetching origin", null],
    ]);
  });

  it("maps typed sync errors to an IpcError with their kind and output", async () => {
    mockIPC(() => {
      throw { kind: "auth_failed", message: "Authentication failed for origin", output: "fatal: could not read Username" };
    });

    const failure = await client.fetch("/r", "op-1", false).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IpcError);
    expect(failure).toMatchObject({ kind: "auth_failed", message: "Authentication failed for origin", output: "fatal: could not read Username" });
  });

  it("delivers repo-changed payloads to the handler until it is unlistened", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: string[] = [];
    const unlisten = await client.onRepoChanged((change) => received.push(change.path));

    await emit("repo-changed", { path: "/r" });
    unlisten();
    await emit("repo-changed", { path: "/later" });

    expect(received).toEqual(["/r"]);
  });

  it("carries hook output on the IpcError of a failed commit", async () => {
    mockIPC(() => {
      throw { kind: "commit_failed", message: "`git commit` exited with status 1", output: "hook says no" };
    });

    const failure = await client.commit("/r", "s", "", false).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IpcError);
    expect(failure).toMatchObject({ kind: "commit_failed", output: "hook says no" });
  });

  it("turns a serialized backend error into an IpcError with its kind and message", async () => {
    mockIPC(() => {
      throw { kind: "not_a_repository", message: "/tmp/x is not inside a Git repository" };
    });

    const failure = await client.repoOpen("/tmp/x").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IpcError);
    expect(failure).toMatchObject({ kind: "not_a_repository", message: "/tmp/x is not inside a Git repository" });
  });

  it("wraps a non-payload failure as an internal IpcError instead of swallowing it", async () => {
    mockIPC(() => {
      throw "command repo_open not found";
    });

    const failure = await client.repoOpen("/x").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IpcError);
    expect(failure).toMatchObject({ kind: "internal", message: "command repo_open not found" });
  });

  it("invokes every phase 3b command by name with camelCase arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    const settings = {
      theme: "light",
      density: "compact",
      default_branch: "main",
      pull_mode: "rebase",
      auto_fetch_minutes: 5,
      editor_command: "",
      terminal_command: "",
      telemetry_opt_in: false,
        gravatar_avatars: true,
    } as const;

    await client.fetch("/r", "op-1", false, false);
    await client.publish("/r", "op-2", "origin");
    await client.authRespond("op-1/auth-1", { kind: "trust" });
    await client.searchCommits("/r", "fix");
    await client.cloneRepo("op-3", "https://example.test/a.git", "/d/a", { shallow: true, sparse: false });
    await client.initRepo("/d/new");
    await client.settingsLoad();
    await client.settingsSave(settings);
    await client.repoSettingsLoad("/r");
    await client.repoSettingsSave("/r", { pull_mode: null });
    await client.identityRead(null);
    await client.identityWrite("/r", "email", null);
    await client.remotesList("/r");
    await client.remoteAdd("/r", "origin", "https://example.test/a.git");
    await client.remoteEdit("/r", "origin", "upstream", "https://example.test/b.git");
    await client.remoteRemove("/r", "upstream");
    await client.recentsList();
    await client.recentAdd("/r");
    await client.recentRemove("/r");
    await client.recentStatuses(["/r"]);
    await client.sessionLoad();
    await client.sessionSave({ tabs: ["/r"], active: 0, groups: [] });
    await client.repoAliasesList();
    await client.repoAliasSet("/r", "Corp A");
    await client.repoAliasSet("/r", null);
    await client.updateCheck();
    await client.updateInstall();
    await client.menuUpdate({ "tab.reopen": false }, { "theme.dark": true });
    await client.openPath("/r/a.txt", "editor");
    await client.activityList();
    await client.activityClear(null);
    await client.undoLast("/r", 7);

    expect(calls).toEqual([
      { cmd: "fetch", args: { path: "/r", id: "op-1", prune: false, interactive: false } },
      { cmd: "publish", args: { path: "/r", id: "op-2", remote: "origin" } },
      { cmd: "auth_respond", args: { id: "op-1/auth-1", reply: { kind: "trust" } } },
      { cmd: "search_commits", args: { path: "/r", query: "fix" } },
      { cmd: "clone_repo", args: { id: "op-3", url: "https://example.test/a.git", destination: "/d/a", options: { shallow: true, sparse: false } } },
      { cmd: "init_repo", args: { path: "/d/new" } },
      { cmd: "settings_load", args: {} },
      { cmd: "settings_save", args: { settings } },
      { cmd: "repo_settings_load", args: { path: "/r" } },
      { cmd: "repo_settings_save", args: { path: "/r", settings: { pull_mode: null } } },
      { cmd: "identity_read", args: { path: null } },
      { cmd: "identity_write", args: { path: "/r", field: "email", value: null } },
      { cmd: "remotes_list", args: { path: "/r" } },
      { cmd: "remote_add", args: { path: "/r", name: "origin", url: "https://example.test/a.git" } },
      { cmd: "remote_edit", args: { path: "/r", name: "origin", newName: "upstream", url: "https://example.test/b.git" } },
      { cmd: "remote_remove", args: { path: "/r", name: "upstream" } },
      { cmd: "recents_list", args: {} },
      { cmd: "recent_add", args: { path: "/r" } },
      { cmd: "recent_remove", args: { path: "/r" } },
      { cmd: "recent_statuses", args: { paths: ["/r"] } },
      { cmd: "session_load", args: {} },
      { cmd: "session_save", args: { session: { tabs: ["/r"], active: 0, groups: [] } } },
      { cmd: "repo_aliases_list", args: {} },
      { cmd: "repo_alias_set", args: { path: "/r", alias: "Corp A" } },
      { cmd: "repo_alias_set", args: { path: "/r", alias: null } },
      { cmd: "update_check", args: {} },
      { cmd: "update_install", args: {} },
      { cmd: "menu_update", args: { enabled: { "tab.reopen": false }, checked: { "theme.dark": true } } },
      { cmd: "open_path", args: { path: "/r/a.txt", with: "editor" } },
      { cmd: "activity_list", args: {} },
      { cmd: "activity_clear", args: { repo: null } },
      { cmd: "undo_last", args: { path: "/r", id: 7 } },
    ]);
  });

  it("delivers a menu-bar choice to its handler", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const chosen: string[] = [];
    const stop = await client.onMenuAction((id) => chosen.push(id));

    await emit("menu-action", "tab.reopen");
    stop();
    await emit("menu-action", "tab.close");

    expect(chosen).toEqual(["tab.reopen"]);
  });

  it("delivers auth prompt and activity events to their handlers", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const prompts: string[] = [];
    const entries: number[] = [];
    const stopPrompt = await client.onAuthPrompt((event) => prompts.push(event.prompt.id));
    const stopActivity = await client.onActivity((entry) => entries.push(entry.id));

    await emit("auth-prompt", { operation: "op-1", prompt: { id: "op-1/auth-1" } });
    await emit("activity-recorded", { id: 4 });
    stopPrompt();
    stopActivity();

    expect(prompts).toEqual(["op-1/auth-1"]);
    expect(entries).toEqual([4]);
  });

  it("returns the folder chosen in the native picker, or undefined when it is dismissed", async () => {
    let choice: string | null = "/picked";
    let received: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "plugin:dialog|open") {
        received = args;
        return choice;
      }
      return null;
    });

    expect(await client.pickFolder("Open a repository")).toBe("/picked");
    expect(received).toMatchObject({ options: { directory: true, multiple: false, title: "Open a repository" } });
    choice = null;
    expect(await client.pickFolder("Open a repository")).toBeUndefined();
  });

  it("returns the path chosen in the native save dialog, or undefined when it is dismissed", async () => {
    let choice: string | null = "/tmp/usage.json";
    let received: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "plugin:dialog|save") {
        received = args;
        return choice;
      }
      return null;
    });

    expect(await client.pickSavePath("Export usage data", "yforge-usage.json")).toBe("/tmp/usage.json");
    expect(received).toMatchObject({ options: { title: "Export usage data", defaultPath: "yforge-usage.json" } });
    choice = null;
    expect(await client.pickSavePath("Export usage data", "yforge-usage.json")).toBeUndefined();
  });

  it("invokes the history, crash, and usage commands by name with their arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return cmd === "crash_export" || cmd === "usage_export" ? 3 : null;
    });
    const report = { kind: "error", message: "boom", stack: null, view: "/repo" };

    await client.activityHistory("/r", null, 25);
    await client.activityHistory("/r", 40, 25);
    await client.crashReport(report);
    await client.crashList(null, 25);
    expect(await client.crashExport("/tmp/crashes.json")).toBe(3);
    await client.crashClear();
    await client.usageList(12, 25);
    expect(await client.usageExport("/tmp/usage.json")).toBe(3);
    await client.usageClear();

    expect(calls).toEqual([
      { cmd: "activity_history", args: { repo: "/r", before: null, limit: 25 } },
      { cmd: "activity_history", args: { repo: "/r", before: 40, limit: 25 } },
      { cmd: "crash_report", args: { report } },
      { cmd: "crash_list", args: { before: null, limit: 25 } },
      { cmd: "crash_export", args: { path: "/tmp/crashes.json" } },
      { cmd: "crash_clear", args: {} },
      { cmd: "usage_list", args: { before: 12, limit: 25 } },
      { cmd: "usage_export", args: { path: "/tmp/usage.json" } },
      { cmd: "usage_clear", args: {} },
    ]);
  });

  it("invokes the remote branch, upstream, autostash, switch-stash, SSH key and worktree commands with their arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });

    await client.checkout("/r", { kind: "local_branch", name: "main" }, true, true);
    await client.deleteRemoteBranch("/r", "op-1", "origin", "feature/x");
    await client.setUpstream("/r", "feature", "origin/feature");
    await client.setUpstream("/r", "feature", null);
    await client.pushTo("/r", "op-2", { remote: "origin", name: "topic", set_upstream: true });
    await client.stashRename("/r", 1, "abc", "new name");
    await client.pullWithAutostash("/r", "op-3", "rebase");
    await client.switchStashes("/r", "main");
    await client.switchStashRestore("/r", "main", "abc");
    await client.switchStashDismiss("/r", "main", "abc");
    await client.sshKeysList();
    await client.worktreeList("/r");

    expect(calls).toEqual([
      { cmd: "checkout", args: { path: "/r", target: { kind: "local_branch", name: "main" }, stash: true, leaveStashed: true } },
      { cmd: "delete_remote_branch", args: { path: "/r", id: "op-1", remote: "origin", name: "feature/x" } },
      { cmd: "set_upstream", args: { path: "/r", branch: "feature", upstream: "origin/feature" } },
      { cmd: "set_upstream", args: { path: "/r", branch: "feature", upstream: null } },
      { cmd: "push_to", args: { path: "/r", id: "op-2", target: { remote: "origin", name: "topic", set_upstream: true } } },
      { cmd: "stash_rename", args: { path: "/r", index: 1, sha: "abc", message: "new name" } },
      { cmd: "pull_with_autostash", args: { path: "/r", id: "op-3", mode: "rebase" } },
      { cmd: "switch_stashes", args: { path: "/r", branch: "main" } },
      { cmd: "switch_stash_restore", args: { path: "/r", branch: "main", sha: "abc" } },
      { cmd: "switch_stash_dismiss", args: { path: "/r", branch: "main", sha: "abc" } },
      { cmd: "ssh_keys_list", args: {} },
      { cmd: "worktree_list", args: { path: "/r" } },
    ]);
  });

  it("passes the graph visibility only when one is given, and sends stash details, stash diffs, and repository UI preferences", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    const prefs = { columns: [{ column: "author" as const, visible: true, width: 120 }], collapsed_folders: ["local:feature"], branch_visibility: { kind: "current_and_upstream" as const } };

    await client.repoGraph("/r", 0, 200, { kind: "current_and_upstream" });
    await client.searchCommits("/r", "fix");
    await client.searchCommits("/r", "fix", { kind: "current_and_upstream" });
    await client.stashDetails("/r", 1, "abc");
    await client.stashFileDiff("/r", 1, "abc", "a.txt", true);
    await client.stashFileDiff("/r", 1, "abc", "a.txt");
    await client.repoUiPrefsLoad("/r");
    await client.repoUiPrefsSave("/r", prefs);

    expect(calls).toEqual([
      { cmd: "repo_graph", args: { path: "/r", offset: 0, limit: 200, visibility: { kind: "current_and_upstream" } } },
      { cmd: "search_commits", args: { path: "/r", query: "fix" } },
      { cmd: "search_commits", args: { path: "/r", query: "fix", visibility: { kind: "current_and_upstream" } } },
      { cmd: "stash_details", args: { path: "/r", index: 1, sha: "abc" } },
      { cmd: "stash_file_diff", args: { path: "/r", index: 1, sha: "abc", file: "a.txt", ignoreWhitespace: true } },
      { cmd: "stash_file_diff", args: { path: "/r", index: 1, sha: "abc", file: "a.txt" } },
      { cmd: "repo_ui_prefs_load", args: { path: "/r" } },
      { cmd: "repo_ui_prefs_save", args: { path: "/r", prefs } },
    ]);
  });

  it("reads a file at a revision, installs the command, and delivers open-path requests", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC(
      (cmd, args) => {
        calls.push({ cmd, args });
        return cmd === "cli_install" ? { path: "/Users/yui/.local/bin/yforge", replaced: false } : null;
      },
      { shouldMockEvents: true },
    );
    const requested: string[] = [];
    const stop = await client.onOpenPathRequested((request) => requested.push(request.path));

    await client.fileAtRevision("/r", "a.txt", "HEAD~1");
    expect(await client.cliInstall()).toEqual({ path: "/Users/yui/.local/bin/yforge", replaced: false });
    await emit("open-path-requested", { path: "/other" });
    stop();

    expect(calls).toEqual([
      { cmd: "file_at_revision", args: { path: "/r", file: "a.txt", rev: "HEAD~1" } },
      { cmd: "cli_install", args: {} },
    ]);
    expect(requested).toEqual(["/other"]);
  });
  it("invokes the history-editing and AI commands by name with their arguments and delivers ai-sign-in events", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC(
      (cmd, args) => {
        calls.push({ cmd, args });
        return null;
      },
      { shouldMockEvents: true },
    );
    const stages: string[] = [];
    const stop = await client.onAiSignIn((event) => stages.push(`${event.operation}:${event.stage.kind}`));

    await client.rebasePlan("/r", "abc");
    await client.rebaseInteractive("/r", "abc", [{ kind: "pick", sha: "d" }, { kind: "reword", sha: "e", message: "m" }]);
    await client.squashCommits("/r", ["d", "e"], "one");
    await client.recomposePreview("/r", "abc");
    await client.recomposeApply("/r", "abc", [{ message: "m", changes: [{ kind: "file", path: "a" }] }]);
    await client.aiProvidersList();
    await client.aiProviderAdd({ kind: "openrouter", auth_mode: "api_key", name: "OR", api_key: "k" });
    await client.aiProviderUpdate({ id: "p1", auth_mode: "api_key", name: "OR", api_key: { kind: "keep" } });
    await client.aiProviderRemove("p1");
    await client.aiProviderTest("p1");
    await client.aiProviderModels("p1");
    await client.aiFeatureConfigList();
    await client.aiFeatureConfigSet("generate_commit", "p1", "m", "{context}");
    await client.aiFeatureConfigEnable("conflict_fix", false);
    await client.aiFeatureConfigReset("recompose");
    await client.aiSignIn("p1", "op-1", "device_code");
    await client.aiGenerateCommitMessage("/r", "op-2");
    await client.aiProposeRecompose("/r", "op-3", "abc");
    await client.aiProposeConflict("/r", "op-4", "a.txt");
    await emit("ai-sign-in", { operation: "op-1", provider: "p1", stage: { kind: "device_code", url: "https://x", code: "ABCD" } });
    stop();

    expect(calls).toEqual([
      { cmd: "rebase_plan", args: { path: "/r", base: "abc" } },
      { cmd: "rebase_interactive", args: { path: "/r", base: "abc", steps: [{ kind: "pick", sha: "d" }, { kind: "reword", sha: "e", message: "m" }] } },
      { cmd: "squash_commits", args: { path: "/r", shas: ["d", "e"], message: "one" } },
      { cmd: "recompose_preview", args: { path: "/r", base: "abc" } },
      { cmd: "recompose_apply", args: { path: "/r", base: "abc", groups: [{ message: "m", changes: [{ kind: "file", path: "a" }] }] } },
      { cmd: "ai_providers_list", args: {} },
      { cmd: "ai_provider_add", args: { input: { kind: "openrouter", auth_mode: "api_key", name: "OR", api_key: "k" } } },
      { cmd: "ai_provider_update", args: { update: { id: "p1", auth_mode: "api_key", name: "OR", api_key: { kind: "keep" } } } },
      { cmd: "ai_provider_remove", args: { id: "p1" } },
      { cmd: "ai_provider_test", args: { id: "p1" } },
      { cmd: "ai_models", args: { providerId: "p1" } },
      { cmd: "ai_feature_config_list", args: {} },
      { cmd: "ai_feature_config_set", args: { feature: "generate_commit", providerId: "p1", modelId: "m", promptTemplate: "{context}" } },
      { cmd: "ai_feature_config_enable", args: { feature: "conflict_fix", enabled: false } },
      { cmd: "ai_feature_config_reset", args: { feature: "recompose" } },
      { cmd: "ai_sign_in", args: { provider: "p1", id: "op-1", method: "device_code" } },
      { cmd: "ai_generate_commit_message", args: { path: "/r", id: "op-2" } },
      { cmd: "ai_propose_recompose", args: { path: "/r", id: "op-3", base: "abc" } },
      { cmd: "ai_propose_conflict", args: { path: "/r", id: "op-4", file: "a.txt" } },
    ]);
    expect(stages).toEqual(["op-1:device_code"]);
  });

  it("invokes the worktree, recovery, and snapshot commands by name with their arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });

    await client.appUiPrefsLoad();
    await client.appUiPrefsSave({ palette_recents: ["a"], last_parent_folder: null });
    await client.worktreeSuggestPath("/r", "feature/x");
    await client.worktreeCreate("/r", "feature/x", true, "refs/heads/main", "/w/r-feature-x");
    await client.worktreeCreate("/r", "spare", false, null, "/w/r-spare");
    await client.worktreeRemove("/r", "/w/r-spare", true);
    await client.worktreeIntegrate("/r", "/w/r-feature-x", "main", true);
    await client.reflogRefs("/r");
    await client.reflogList("/r", "HEAD", null, 50);
    await client.reflogList("/r", "refs/heads/main", 49, 50);
    await client.lostCommits("/r", "scan-1");
    await client.restoreAsBranch("/r", "abc1234", "rescued");
    await client.restoreCheckout("/r", "abc1234");
    await client.restoreReset("/r", "abc1234", "hard");
    await client.snapshotsList("/r");
    await client.snapshotFiles("/r", "refs/yforge/snapshots/1-discard");
    await client.snapshotRestoreFiles("/r", "refs/yforge/snapshots/1-discard", ["a.txt"]);
    await client.snapshotRestoreAll("/r", "refs/yforge/snapshots/1-discard", false);
    await client.snapshotDelete("/r", "refs/yforge/snapshots/1-discard");

    expect(calls).toEqual([
      { cmd: "app_ui_prefs_load", args: {} },
      { cmd: "app_ui_prefs_save", args: { prefs: { palette_recents: ["a"], last_parent_folder: null } } },
      { cmd: "worktree_suggest_path", args: { path: "/r", branch: "feature/x" } },
      { cmd: "worktree_create", args: { path: "/r", branch: "feature/x", create: true, start: "refs/heads/main", destination: "/w/r-feature-x" } },
      { cmd: "worktree_create", args: { path: "/r", branch: "spare", create: false, start: null, destination: "/w/r-spare" } },
      { cmd: "worktree_remove", args: { path: "/r", worktree: "/w/r-spare", force: true } },
      { cmd: "worktree_integrate", args: { path: "/r", worktree: "/w/r-feature-x", target: "main", cleanup: true } },
      { cmd: "reflog_refs", args: { path: "/r" } },
      { cmd: "reflog_list", args: { path: "/r", reference: "HEAD", before: null, limit: 50 } },
      { cmd: "reflog_list", args: { path: "/r", reference: "refs/heads/main", before: 49, limit: 50 } },
      { cmd: "lost_commits", args: { path: "/r", id: "scan-1" } },
      { cmd: "restore_as_branch", args: { path: "/r", sha: "abc1234", name: "rescued" } },
      { cmd: "restore_checkout", args: { path: "/r", sha: "abc1234" } },
      { cmd: "restore_reset", args: { path: "/r", sha: "abc1234", mode: "hard" } },
      { cmd: "snapshots_list", args: { path: "/r" } },
      { cmd: "snapshot_files", args: { path: "/r", reference: "refs/yforge/snapshots/1-discard" } },
      { cmd: "snapshot_restore_files", args: { path: "/r", reference: "refs/yforge/snapshots/1-discard", files: ["a.txt"] } },
      { cmd: "snapshot_restore_all", args: { path: "/r", reference: "refs/yforge/snapshots/1-discard", force: false } },
      { cmd: "snapshot_delete", args: { path: "/r", reference: "refs/yforge/snapshots/1-discard" } },
    ]);
  });
});

describe("platform integration commands", () => {
  it("invokes each platform command by name with camelCase arguments and returns the typed result", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const connection = { id: "c1", kind: "gitlab", host: "git.example.com:8443", name: "Work", insecure_tls: true, created_at: 1 };
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "platform_connections_list") return [connection];
      if (cmd === "platform_connection_add") return connection;
      if (cmd === "platform_connection_test") return "yui";
      if (cmd === "platform_repo_match") return { connection, remote: "origin", repo: { owner: "team", repo: "app" } };
      return null;
    });
    const input = { source_ref: "feature/x", target_ref: "main", title: "Add x", body: "" };

    expect(await client.platformConnectionsList()).toEqual([connection]);
    expect(await client.platformConnectionAdd("gitlab", "git.example.com:8443", "Work", "glpat-1", true)).toEqual(connection);
    expect(await client.platformConnectionRemove("c1")).toBeNull();
    expect(await client.platformConnectionTest("c1")).toBe("yui");
    expect((await client.platformRepoMatch("/r"))?.repo).toEqual({ owner: "team", repo: "app" });
    await client.platformPrsList("/r", "open");
    await client.platformPrsList("/r", "all");
    await client.platformPrDetail("/r", 7);
    await client.platformPrCreate("/r", input);
    await client.platformPrMerge("/r", 7);

    expect(calls).toEqual([
      { cmd: "platform_connections_list", args: {} },
      { cmd: "platform_connection_add", args: { kind: "gitlab", host: "git.example.com:8443", name: "Work", token: "glpat-1", insecureTls: true } },
      { cmd: "platform_connection_remove", args: { id: "c1" } },
      { cmd: "platform_connection_test", args: { id: "c1" } },
      { cmd: "platform_repo_match", args: { path: "/r" } },
      { cmd: "platform_prs_list", args: { path: "/r", state: "open" } },
      { cmd: "platform_prs_list", args: { path: "/r", state: "all" } },
      { cmd: "platform_pr_detail", args: { path: "/r", number: 7 } },
      { cmd: "platform_pr_create", args: { path: "/r", input } },
      { cmd: "platform_pr_merge", args: { path: "/r", number: 7 } },
    ]);
  });

  it("invokes each Jira and Launchpad command by name with camelCase arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "jira_connection_test") return "Sam Lee";
      if (cmd === "jira_branch_name") return "ABC-1-fix";
      return null;
    });

    await client.jiraConnectionsList();
    await client.jiraConnectionAdd("cloud", "https://your-site.atlassian.net", "you@example.com", "tok");
    await client.jiraConnectionAdd("data_center", "https://jira.corp", null, "pat");
    await client.jiraConnectionRemove("j1");
    expect(await client.jiraConnectionTest("j1")).toBe("Sam Lee");
    await client.jiraFieldProblem("site", "x");
    await client.jiraMyIssues("j1");
    await client.jiraIssuesLookup(["ABC-1"]);
    await client.jiraIssueKeys(["fix ABC-1"]);
    expect(await client.jiraBranchName("ABC-1", "Fix")).toBe("ABC-1-fix");
    await client.platformMyPulls("c1");
    await client.launchpadWips();

    expect(calls).toEqual([
      { cmd: "jira_connections_list", args: {} },
      { cmd: "jira_connection_add", args: { kind: "cloud", site: "https://your-site.atlassian.net", email: "you@example.com", token: "tok" } },
      { cmd: "jira_connection_add", args: { kind: "data_center", site: "https://jira.corp", email: null, token: "pat" } },
      { cmd: "jira_connection_remove", args: { id: "j1" } },
      { cmd: "jira_connection_test", args: { id: "j1" } },
      { cmd: "jira_field_problem", args: { field: "site", value: "x" } },
      { cmd: "jira_my_issues", args: { id: "j1" } },
      { cmd: "jira_issues_lookup", args: { keys: ["ABC-1"] } },
      { cmd: "jira_issue_keys", args: { texts: ["fix ABC-1"] } },
      { cmd: "jira_branch_name", args: { key: "ABC-1", summary: "Fix" } },
      { cmd: "platform_my_pulls", args: { id: "c1" } },
      { cmd: "launchpad_wips", args: {} },
    ]);
  });

  it("returns the paged lists with their true total and cap flag as the backend sent them", async () => {
    const pulls = { pulls: [], total: 1500, capped: true };
    const launchpad = { pulls: [], total: null, capped: true };
    const issues = { issues: [], total: 7, capped: false };
    const detail = { pull: {}, files: [], files_total: null, files_capped: true };
    mockIPC((cmd) => ({ platform_prs_list: pulls, platform_my_pulls: launchpad, jira_my_issues: issues, platform_pr_detail: detail })[cmd] ?? null);

    expect(await client.platformPrsList("/r", "open")).toEqual(pulls);
    expect(await client.platformMyPulls("c1")).toEqual(launchpad);
    expect(await client.jiraMyIssues("j1")).toEqual(issues);
    expect(await client.platformPrDetail("/r", 1)).toEqual(detail);
  });

  it("raises an IpcError carrying the platform error kind and message", async () => {
    mockIPC(() => {
      throw { kind: "auth_failed", message: "Authentication failed for github.com", output: null };
    });

    await expect(client.platformConnectionTest("c1")).rejects.toMatchObject({ name: "IpcError", kind: "auth_failed", message: "Authentication failed for github.com" });
  });

  it("opens only http and https addresses in a new browsing context without opener access", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    client.openUrl("https://github.com/team/app/pull/7");

    expect(open).toHaveBeenCalledWith("https://github.com/team/app/pull/7", "_blank", "noopener,noreferrer");
    expect(() => client.openUrl("javascript:alert(1)")).toThrow("is not an http or https address");
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("Git host identity commands", () => {
  it("sends the host, the key file, and the passphrase to key generation by their command argument names", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return cmd === "git_host_default_key_path" ? "~/.ssh/yforge_gitlab.corp-b.com" : cmd === "git_host_generate_key" ? "/Users/yui/.ssh/yforge_gitlab.corp-b.com" : null;
    });

    expect(await client.gitHostDefaultKeyPath("gitlab.corp-b.com:2222")).toBe("~/.ssh/yforge_gitlab.corp-b.com");
    expect(await client.gitHostGenerateKey("gitlab.corp-b.com:2222", "~/.ssh/yforge_gitlab.corp-b.com", "open sesame")).toBe("/Users/yui/.ssh/yforge_gitlab.corp-b.com");
    await client.gitHostGenerateKey("github.com", "~/.ssh/yforge_github.com", null);
    await client.gitHostFieldProblem("new_key", "~/.ssh/yforge_github.com");

    expect(calls).toEqual([
      { cmd: "git_host_default_key_path", args: { host: "gitlab.corp-b.com:2222" } },
      { cmd: "git_host_generate_key", args: { host: "gitlab.corp-b.com:2222", keyPath: "~/.ssh/yforge_gitlab.corp-b.com", passphrase: "open sesame" } },
      { cmd: "git_host_generate_key", args: { host: "github.com", keyPath: "~/.ssh/yforge_github.com", passphrase: null } },
      { cmd: "git_host_field_problem", args: { field: "new_key", value: "~/.ssh/yforge_github.com" } },
    ]);
  });
});
