import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LostCommit } from "../ipc/bindings/LostCommit";
import type { ReflogEntry } from "../ipc/bindings/ReflogEntry";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { SnapshotChange } from "../ipc/bindings/SnapshotChange";
import type { SnapshotInfo } from "../ipc/bindings/SnapshotInfo";
import { RecoveryView } from "./RecoveryView";
import { buttonNamed, choose, flush, mountWithApp, type, testSession } from "./testkit";

let dispose: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

beforeEach(() => {
  calls = [];
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const HEAD = "a".repeat(40);
const repo = (head: RepoSnapshot["head"] = { kind: "branch", name: "main", sha: HEAD }): RepoSnapshot =>
  ({ root: "/r", head, branches: ["main", "restored-1111111"], worktrees: [], counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, files: [], operation: null, remotes: [], remote_branches: [], tags: [], stashes: [] }) as unknown as RepoSnapshot;

const entry = (index: number, overrides: Partial<ReflogEntry> = {}): ReflogEntry => ({ index, selector: `HEAD@{${index}}`, sha: `${index + 1}`.repeat(40).slice(0, 40), previous_sha: null, action: "commit", message: "commit: message", time: 1_700_000_000, summary: `Commit ${index}`, exists: true, ...overrides });
const lost = (sha: string, kind: LostCommit["kind"] = "commit"): LostCommit => ({ sha, summary: `Lost ${sha.slice(0, 2)}`, author: "Ada", time: 1_700_000_000, kind });
const snapshotInfo = (name: string, overrides: Partial<SnapshotInfo> = {}): SnapshotInfo => ({ ref: `refs/yforge/snapshots/${name}`, time: 1_700_000_000, action: "discard", description: "Discarded 2 files", head_sha: HEAD, branch: "main", files_changed: 2, ...overrides });
const change = (path: string, status: SnapshotChange["status"] = "modified"): SnapshotChange => ({ path, status });

type Handlers = Partial<Record<string, (args: Record<string, unknown>) => unknown>>;

function mount(handlers: Handlers = {}, options: { tab?: "reflog" | "lost" | "snapshots"; head?: RepoSnapshot["head"] } = {}) {
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    const handler = handlers[cmd];
    if (handler !== undefined) return handler(call.args);
    if (cmd === "reflog_refs") return ["HEAD", "refs/heads/main"];
    if (cmd === "reflog_list") return [];
    if (cmd === "snapshots_list") return [];
    if (cmd === "repo_open") return repo(options.head);
    return null;
  });
  const closed = vi.fn();
  const mounted = mountWithApp(() => <RecoveryView session={testSession("/r", repo(options.head))} tab={options.tab ?? "reflog"} onClose={closed} />);
  dispose = mounted.dispose;
  return { ...mounted, closed };
}

const rows = (host: ParentNode, label: string) => [...host.querySelectorAll(`[aria-label="${label}"] > li`)];
const named = (host: ParentNode, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const confirmButton = (text: string) => buttonNamed(document, text);

describe("recovery view", () => {
  it("states the recovery limits, names the three tabs, and closes back to the graph", async () => {
    const { host, closed } = mount();
    await flush();

    const limits = host.querySelector('[aria-label="Recovery limits"]');
    expect(limits?.textContent).toContain("Work changed outside YForge and never committed cannot be recovered.");
    expect(limits?.textContent).toContain("Objects Git has already pruned cannot be recovered.");
    expect(limits?.textContent).toContain("pushed only by git push --mirror");
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toEqual(["Reflog", "Lost commits", "Snapshots"]);
    buttonNamed(host, "Back to graph")?.click();
    expect(closed).toHaveBeenCalledOnce();
  });

  describe("reflog", () => {
    it("ages a reflog entry's time as the clock ticks", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      try {
        vi.setSystemTime(new Date(1_700_000_020 * 1000));
        const { host } = mount({ reflog_list: () => [entry(0)] });
        await flush(40);
        const age = () => host.querySelector('[aria-label="Reflog entries"] .dim[title]')?.textContent;
        expect(age()).toBe("20s ago");

        vi.advanceTimersByTime(2 * 60 * 60 * 1000);
        await flush();

        expect(age()).toBe("2h ago");
      } finally {
        vi.useRealTimers();
      }
    });

    it("lists HEAD and each branch, shows the entries of the chosen reference, and pages older ones by the last index", async () => {
      const page = (from: number, count: number) => Array.from({ length: count }, (_, offset) => entry(from + offset));
      const { host } = mount({
        reflog_list: (args) => (args.before === null ? page(0, 50) : page(50, 3)),
      });
      await flush(40);
      expect(calls.find((call) => call.cmd === "reflog_list")?.args).toEqual({ path: "/r", reference: "HEAD", before: null, limit: 50 });
      expect(rows(host, "Reflog entries")).toHaveLength(50);
      expect(rows(host, "Reflog entries")[0]?.textContent).toContain("commit");
      expect(rows(host, "Reflog entries")[0]?.textContent).toContain("Commit 0");
      expect(rows(host, "Reflog entries")[0]?.textContent).toContain("HEAD@{0}");

      buttonNamed(host, "Show older")?.click();
      await flush(40);

      expect(calls.filter((call) => call.cmd === "reflog_list").at(-1)?.args).toEqual({ path: "/r", reference: "HEAD", before: 49, limit: 50 });
      expect(rows(host, "Reflog entries")).toHaveLength(53);
      expect(buttonNamed(host, "Show older")).toBeUndefined();
    });

    it("switches the reference and reads that branch's reflog from the newest entry", async () => {
      const { host } = mount({ reflog_list: (args) => (args.reference === "HEAD" ? [entry(0)] : [entry(0, { selector: "main@{0}", summary: "On main" })]) });
      await flush(40);

      await choose(host, "Reference", "main");
      await flush(40);

      expect(calls.filter((call) => call.cmd === "reflog_list").at(-1)?.args).toEqual({ path: "/r", reference: "refs/heads/main", before: null, limit: 50 });
      expect(rows(host, "Reflog entries")[0]?.textContent).toContain("main@{0}");
    });

    it("says so when an entry's commit was pruned and disables its restore actions with the reason", async () => {
      const { host } = mount({ reflog_list: () => [entry(0, { exists: false, summary: "" })] });
      await flush(40);

      const row = rows(host, "Reflog entries")[0] as Element;
      expect(row.textContent).toContain("Commit no longer exists");
      const restore = named(row, "Restore 1111111 as a branch");
      expect(restore?.disabled).toBe(true);
      expect(restore?.title).toBe("Git has already pruned this commit");
    });

    it("restores an entry as a new branch from a popover with a suggested name, refusing a name in use", async () => {
      const { host } = mount({ reflog_list: () => [entry(0, { sha: "1".repeat(40) })] });
      await flush(40);

      named(host, "Restore 1111111 as a branch")?.click();
      await flush();
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Branch name"]');
      expect(input?.value).toBe("restored-1111111-2");
      const create = buttonNamed(document, "Create branch") as HTMLButtonElement;
      type(input, "main");
      await flush();
      expect(create.disabled).toBe(true);
      expect(document.body.textContent).toContain("A branch named main already exists");
      type(input, "rescued");
      await flush();
      create.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "restore_as_branch")?.args).toEqual({ path: "/r", sha: "1".repeat(40), name: "rescued" });
    });

    it("checks an entry out detached after a confirmation that says the working tree must be clean", async () => {
      const { host } = mount({ reflog_list: () => [entry(0, { sha: "1".repeat(40) })] });
      await flush(40);

      named(host, "Check out 1111111 (detached)")?.click();
      await flush();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("working tree must be clean");
      expect(calls.some((call) => call.cmd === "restore_checkout")).toBe(false);
      confirmButton("Check out detached")?.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "restore_checkout")?.args).toEqual({ path: "/r", sha: "1".repeat(40) });
    });

    it("resets the current branch in the chosen mode, asking first only for a hard reset", async () => {
      const { host } = mount({ reflog_list: () => [entry(0, { sha: "1".repeat(40) })] });
      await flush(40);

      named(host, "Reset main to 1111111")?.click();
      await flush();
      const items = [...document.querySelectorAll('[role="menuitem"] .label-text')].map((label) => label.textContent);
      expect(items).toEqual(["Soft", "Mixed", "Hard"]);
      (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click();
      await flush(40);
      expect(calls.find((call) => call.cmd === "restore_reset")?.args).toEqual({ path: "/r", sha: "1".repeat(40), mode: "mixed" });

      named(host, "Reset main to 1111111")?.click();
      await flush();
      (document.querySelectorAll('[role="menuitem"]')[2] as HTMLElement).click();
      await flush();
      expect(calls.filter((call) => call.cmd === "restore_reset")).toHaveLength(1);
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Uncommitted changes to tracked files are discarded");
      confirmButton("Hard reset")?.click();
      await flush(40);

      expect(calls.filter((call) => call.cmd === "restore_reset").at(-1)?.args).toEqual({ path: "/r", sha: "1".repeat(40), mode: "hard" });
    });

    it("explains that a detached HEAD has no branch to reset", async () => {
      const { host } = mount({ reflog_list: () => [entry(0)] }, { head: { kind: "detached", sha: HEAD } });
      await flush(40);

      const reset = named(host, "Reset the current branch to 1111111");
      expect(reset?.disabled).toBe(true);
      expect(reset?.title).toBe("HEAD is detached, so there is no branch to reset");
    });

    it("shows the failure when the reflog cannot be read", async () => {
      const { host } = mount({
        reflog_list: () => {
          throw { kind: "git_failed", message: "cannot read the reflog", output: null };
        },
      });
      await flush(40);

      expect(host.querySelector('[role="alert"]')?.textContent).toContain("cannot read the reflog");
    });
  });

  describe("lost commits", () => {
    it("scans with an operation id, shows stash-shaped commits as stashes, and restores from a result", async () => {
      const { host } = mount({ lost_commits: () => [lost("c".repeat(40)), lost("d".repeat(40), "stash")] }, { tab: "lost" });
      await flush();

      buttonNamed(host, "Scan for lost commits")?.click();
      await flush(40);

      const scan = calls.find((call) => call.cmd === "lost_commits");
      expect(scan?.args.path).toBe("/r");
      expect(typeof scan?.args.id).toBe("string");
      const results = rows(host, "Lost commits");
      expect(results.map((row) => row.textContent)).toEqual([expect.stringContaining("Lost cc"), expect.stringContaining("Lost dd")]);
      expect(results[1]?.textContent).toContain("Dropped stash");
      expect(named(host, "Restore ccccccc as a branch")).not.toBeNull();
    });

    it("cancels a running scan through operation_cancel with the scan's id and reports it stopped", async () => {
      let release: (value: LostCommit[]) => void = () => undefined;
      const { host } = mount({ lost_commits: () => new Promise<LostCommit[]>((resolve) => (release = resolve)) }, { tab: "lost" });
      await flush();

      buttonNamed(host, "Scan for lost commits")?.click();
      await flush();
      expect(host.querySelector('[role="status"]')?.textContent).toContain("Scanning with git fsck");
      buttonNamed(host, "Cancel scan")?.click();
      await flush();

      const scan = calls.find((call) => call.cmd === "lost_commits");
      expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: scan?.args.id });
      release([]);
      await flush();
    });

    it("says when nothing was found and when the scan was cancelled", async () => {
      const { host } = mount(
        {
          lost_commits: () => {
            throw { kind: "cancelled", message: "The operation was cancelled", output: null };
          },
        },
        { tab: "lost" },
      );
      await flush();

      buttonNamed(host, "Scan for lost commits")?.click();
      await flush(40);

      expect(host.textContent).toContain("Scan cancelled. Nothing changed.");
    });

    it("reports an empty scan", async () => {
      const { host } = mount({ lost_commits: () => [] }, { tab: "lost" });
      await flush();

      buttonNamed(host, "Scan for lost commits")?.click();
      await flush(40);

      expect(host.textContent).toContain("No lost commits found.");
    });
  });

  describe("snapshots", () => {
    const first = snapshotInfo("100-discard");
    const second = snapshotInfo("200-reset_hard", { action: "reset_hard", description: "Hard reset to 1111111", head_sha: "b".repeat(40), files_changed: 0 });
    const withSnapshots: Handlers = {
      snapshots_list: () => [first, second],
      snapshot_files: (args) => (args.reference === first.ref ? [change("src/a.ts"), change("notes.txt", "added")] : []),
    };

    it("lists the snapshots newest first with what was done, the file count, and the retention in text", async () => {
      const { host } = mount(withSnapshots, { tab: "snapshots" });
      await flush(40);

      const list = rows(host, "Snapshots");
      expect(list).toHaveLength(2);
      expect(list[0]?.textContent).toContain("Discard");
      expect(list[0]?.textContent).toContain("Discarded 2 files");
      expect(list[0]?.textContent).toContain("2 files");
      expect(list[1]?.textContent).toContain("Hard reset");
    });

    it("says when there are no snapshots", async () => {
      const { host } = mount({ snapshots_list: () => [] }, { tab: "snapshots" });
      await flush(40);

      expect(host.textContent).toContain("No snapshots yet. YForge saves one before it discards, hard-resets, rewrites history, drops a stash, or deletes a branch.");
    });

    it("shows the files of a snapshot with named status icons and restores the checked ones", async () => {
      const { host } = mount({ ...withSnapshots, snapshot_restore_files: () => "refs/yforge/snapshots/300-restore_files" }, { tab: "snapshots" });
      await flush(40);

      named(host, "Show files of Discard")?.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "snapshot_files")?.args).toEqual({ path: "/r", reference: first.ref });
      const files = rows(host, "Snapshot files");
      expect(files.map((row) => [row.querySelector(".badge")?.getAttribute("aria-label"), row.querySelector(".badge svg")?.getAttribute("data-icon"), row.querySelector(".badge")?.textContent, row.querySelector(".path-line")?.textContent])).toEqual([["Modified", "edit", "", "src/a.ts"], ["Added", "plus", "", "notes.txt"]]);
      const restore = buttonNamed(host, "Restore selected files") as HTMLButtonElement;
      expect(restore.disabled).toBe(true);
      const box = host.querySelector<HTMLInputElement>('input[aria-label="Restore src/a.ts"]') as HTMLInputElement;
      box.click();
      await flush();
      expect(restore.disabled).toBe(false);
      restore.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "snapshot_restore_files")?.args).toEqual({ path: "/r", reference: first.ref, files: ["src/a.ts"] });
      expect(host.textContent).toContain("The previous state is saved as refs/yforge/snapshots/300-restore_files");
    });

    it("restores everything without force while HEAD is where the snapshot was", async () => {
      const { host } = mount({ ...withSnapshots, snapshot_restore_all: () => "refs/yforge/snapshots/300-restore_snapshot" }, { tab: "snapshots" });
      await flush(40);

      named(host, "Show files of Discard")?.click();
      await flush(40);
      buttonNamed(host, "Restore everything…")?.click();
      await flush();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).not.toContain("HEAD moved");
      confirmButton("Restore everything")?.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "snapshot_restore_all")?.args).toEqual({ path: "/r", reference: first.ref, force: false });
      expect(host.textContent).toContain("The previous state is saved as refs/yforge/snapshots/300-restore_snapshot");
    });

    it("asks for a forced restore in the confirmation when HEAD moved, naming both commits", async () => {
      const { host } = mount({ ...withSnapshots, snapshot_restore_all: () => "refs/yforge/snapshots/300-restore_snapshot" }, { tab: "snapshots", head: { kind: "branch", name: "main", sha: "b".repeat(40) } });
      await flush(40);

      named(host, "Show files of Discard")?.click();
      await flush(40);
      buttonNamed(host, "Restore everything…")?.click();
      await flush();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("HEAD moved from aaaaaaa to bbbbbbb");
      confirmButton("Restore everything")?.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "snapshot_restore_all")?.args).toEqual({ path: "/r", reference: first.ref, force: true });
    });

    it("deletes a snapshot after a confirmation that says only that ref goes", async () => {
      const { host } = mount(withSnapshots, { tab: "snapshots" });
      await flush(40);

      named(host, "Show files of Discard")?.click();
      await flush(40);
      buttonNamed(host, "Delete snapshot…")?.click();
      await flush();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Only this snapshot is deleted");
      expect(calls.some((call) => call.cmd === "snapshot_delete")).toBe(false);
      confirmButton("Delete snapshot")?.click();
      await flush(40);

      expect(calls.find((call) => call.cmd === "snapshot_delete")?.args).toEqual({ path: "/r", reference: first.ref });
    });
  });
});
