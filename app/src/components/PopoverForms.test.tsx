import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { PopoverState, RepoActions } from "../state/repoActions";
import { createRepoSession } from "../state/repoSession";
import { BranchNameForm, StashForm } from "./BranchForms";
import { TagForm } from "./IntegrationForms";
import { PushToForm, RenameStashForm, SetUpstreamForm } from "./RemoteForms";
import { buttonNamed, choose, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

beforeEach(() => {
  window.innerWidth = 1024;
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const anchor = { left: 10, top: 10 };
const counts = { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
const snapshot = { root: "/r", branches: ["main"], counts } as unknown as RepoSnapshot;

function actionsStub() {
  const calls: Array<[string, ...unknown[]]> = [];
  const actions = {
    closePopover: () => calls.push(["close"]),
    submitCreateTag: async (options: unknown) => {
      calls.push(["tag", options]);
      return undefined;
    },
    stashChanges: async (message: string, untracked: boolean) => {
      calls.push(["stash", message, untracked]);
    },
    submitCreateBranch: async (name: string, checkOut: boolean) => {
      calls.push(["create", name, checkOut]);
    },
    renameBranch: async (from: string, to: string) => {
      calls.push(["rename", from, to]);
    },
    setUpstream: async (branch: string, upstream: string | null) => {
      calls.push(["upstream", branch, upstream]);
    },
    pushTo: async (target: unknown) => {
      calls.push(["push_to", target]);
    },
    renameStash: async (stash: { index: number }, message: string) => {
      calls.push(["rename_stash", stash.index, message]);
    },
  } as unknown as RepoActions;
  return { calls, actions };
}

const input = (host: ParentNode, label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const reason = (host: ParentNode) => host.querySelector(".reason")?.textContent;
const submit = (host: ParentNode) => host.querySelector<HTMLButtonElement>('button[type="submit"]');

describe("tag form", () => {
  function mountTag() {
    const { calls, actions } = actionsStub();
    const state = { kind: "create_tag", anchor, at: "main", remote: "origin" } as unknown as Extract<PopoverState, { kind: "create_tag" }>;
    const mounted = mountWithApp(() => <TagForm state={state} actions={actions} />);
    dispose = mounted.dispose;
    return { ...mounted, calls };
  }

  it("asks for a name first, then for a message once annotated", async () => {
    const { host } = mountTag();
    await flush();
    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("Enter a tag name");

    type(input(host, "Tag name"), "v1");
    await flush();
    expect(submit(host)?.disabled).toBe(false);

    host.querySelectorAll<HTMLInputElement>('input[name="tag-kind"]')[1]?.click();
    await flush();
    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("Enter a message for the annotated tag");
  });

  it("submits the trimmed name, the message only when annotated, and the push choice", async () => {
    const { host, calls } = mountTag();
    await flush();
    type(input(host, "Tag name"), " v1 ");
    input(host, "Tag name")?.closest("form")?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await flush();

    submit(host)?.click();
    await flush(40);

    expect(calls.find(([name]) => name === "tag")?.[1]).toEqual({ name: "v1", message: null, push: true });
  });
});

describe("stash form", () => {
  function mountStash(current = snapshot) {
    const { calls, actions } = actionsStub();
    const mounted = mountWithApp((app) => {
      const session = createRoot(() => createRepoSession("/r", current, app.queryClient));
      return <StashForm state={{ kind: "stash", anchor } as Extract<PopoverState, { kind: "stash" }>} session={session} actions={actions} />;
    });
    dispose = mounted.dispose;
    return { ...mounted, calls };
  }

  it("stashes with the message and the untracked choice", async () => {
    const { host, calls } = mountStash();
    await flush();
    type(input(host, "Stash message"), "wip");
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await flush();

    submit(host)?.click();
    await flush(40);

    expect(calls.find(([name]) => name === "stash")).toEqual(["stash", "wip", true]);
  });

  it("explains why it cannot stash when only untracked files changed", async () => {
    const { host } = mountStash({ ...snapshot, counts: { ...counts, modified: 0, untracked: 2 } } as RepoSnapshot);
    await flush();

    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("Only untracked files changed; include them to stash");

    host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await flush();
    expect(submit(host)?.disabled).toBe(false);
  });
});

describe("branch name form", () => {
  function mountBranch(kind: "create_branch" | "rename_branch", handler: (name: string) => unknown = () => null) {
    mockIPC((cmd, args) => (cmd === "check_branch_name" ? handler((args as { name: string }).name) : null));
    const { calls, actions } = actionsStub();
    const state = (kind === "create_branch" ? { kind, anchor, at: "main" } : { kind, anchor, name: "main" }) as unknown as Extract<PopoverState, { kind: "create_branch" | "rename_branch" }>;
    const mounted = mountWithApp((app) => {
      const session = createRoot(() => createRepoSession("/r", snapshot, app.queryClient));
      return <BranchNameForm state={state} session={session} actions={actions} />;
    });
    dispose = mounted.dispose;
    return { ...mounted, calls };
  }

  it("accepts a name only after git approves it, then creates and checks out", async () => {
    const asked: string[] = [];
    const { host, calls } = mountBranch("create_branch", (name) => {
      asked.push(name);
      return name;
    });
    await flush();
    expect(reason(host)).toBe("Enter a branch name");

    type(input(host, "Branch name"), "feature/ok");
    await flush(60);
    expect(asked).toEqual(["feature/ok"]);
    expect(submit(host)?.disabled).toBe(false);

    submit(host)?.click();
    await flush(40);
    expect(calls.find(([name]) => name === "create")).toEqual(["create", "feature/ok", true]);
  });

  it("reports names git rejects and never sends existing names to git", async () => {
    const asked: string[] = [];
    const { host } = mountBranch("create_branch", (name) => {
      asked.push(name);
      throw { kind: "invalid_request", message: "bad", output: null };
    });
    await flush();

    type(input(host, "Branch name"), "bad name");
    await flush(60);
    expect(reason(host)).toBe("bad name is not a valid branch name");
    expect(submit(host)?.disabled).toBe(true);

    type(input(host, "Branch name"), "main");
    await flush(60);
    expect(reason(host)).toBe("A branch named main already exists");
    expect(asked).toEqual(["bad name"]);
  });

  it("ignores a slow answer for a name that has since been replaced", async () => {
    const releases: Array<() => void> = [];
    const { host } = mountBranch("create_branch", (name) =>
      name === "slow bad" ? new Promise((_resolve, reject) => releases.push(() => reject({ kind: "invalid_request", message: "x", output: null }))) : name,
    );
    await flush();

    type(input(host, "Branch name"), "slow bad");
    await flush();
    type(input(host, "Branch name"), "good");
    await flush(60);
    releases.forEach((release) => release());
    await flush(60);

    expect(submit(host)?.disabled).toBe(false);
    expect(reason(host)).toBeUndefined();
  });

  it("renames only to a different name", async () => {
    const { host, calls } = mountBranch("rename_branch");
    await flush();
    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("Enter a different name");

    type(input(host, "Branch name"), "trunk");
    await flush(60);
    buttonNamed(host, "Rename")?.click();
    await flush(40);

    expect(calls.find(([name]) => name === "rename")).toEqual(["rename", "main", "trunk"]);
    expect(calls.some(([name]) => name === "close")).toBe(true);
  });
});

const remoteSnapshot = (overrides: Record<string, unknown> = {}) =>
  ({
    root: "/r",
    head: { kind: "branch", name: "feature", sha: "a" },
    upstream: null,
    remotes: ["backup", "origin"],
    remote_branches: ["backup/feature", "origin/main", "origin/feature"],
    counts,
    ...overrides,
  }) as unknown as RepoSnapshot;

describe("set upstream form", () => {
  function mountUpstream(branch: string, shape = remoteSnapshot()) {
    const { calls, actions } = actionsStub();
    const state = { kind: "set_upstream", anchor, branch } as Extract<PopoverState, { kind: "set_upstream" }>;
    const mounted = mountWithApp(() => <SetUpstreamForm state={state} snapshot={shape} actions={actions} />);
    dispose = mounted.dispose;
    return { ...mounted, calls };
  }
  const selectLabel = (host: ParentNode) =>
    host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.getAttribute("aria-label") ?? "Upstream branch";
  const chosenLabel = (host: ParentNode) =>
    host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"] .select-value')?.textContent;

  it("offers every remote branch, preselects the one with the branch's name on the preferred remote, and sets it", async () => {
    const { host, calls } = mountUpstream("feature");
    await flush();

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    trigger?.click();
    await flush();
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent?.replace(/\s+/g, " ").trim())).toEqual(["backup/feature", "origin/main", "origin/feature"]);
    trigger?.click();
    await flush();
    expect(chosenLabel(host)).toBe("origin/feature");
    submit(host)?.click();
    await flush();

    expect(calls).toEqual([["upstream", "feature", "origin/feature"]]);
  });

  it("sets the chosen remote branch", async () => {
    const { host, calls } = mountUpstream("feature");
    await flush();
    await choose(host, selectLabel(host), "origin/main");
    submit(host)?.click();
    await flush();

    expect(calls).toEqual([["upstream", "feature", "origin/main"]]);
  });

  it("explains an empty choice list and disables Set upstream", async () => {
    const { host } = mountUpstream("feature", remoteSnapshot({ remote_branches: [] }));
    await flush();

    expect(reason(host)).toBe("No remote branches yet. Fetch first, or push the branch to create one.");
    expect(submit(host)?.disabled).toBe(true);
  });
});

describe("Push to… form", () => {
  function mountPushTo(shape = remoteSnapshot()) {
    const { calls, actions } = actionsStub();
    const state = { kind: "push_to", anchor } as Extract<PopoverState, { kind: "push_to" }>;
    const mounted = mountWithApp(() => <PushToForm state={state} snapshot={shape} actions={actions} />);
    dispose = mounted.dispose;
    return { ...mounted, calls };
  }

  it("defaults to the preferred remote, the current branch name, and sets the upstream when the branch has none", async () => {
    const { host, calls } = mountPushTo();
    await flush();

    expect(host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"] .select-value')?.textContent).toBe("origin");
    expect(input(host, "Remote branch name")?.value).toBe("feature");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Set as upstream"]')?.checked).toBe(true);
    submit(host)?.click();
    await flush();

    expect(calls).toEqual([["push_to", { remote: "origin", name: "feature", set_upstream: true }]]);
  });

  it("pushes to the typed name on the chosen remote without the upstream when unchecked", async () => {
    const { host, calls } = mountPushTo(remoteSnapshot({ upstream: { name: "origin/feature", ahead_behind: null } }));
    await flush();
    await choose(host, "Remote", "backup");
    type(input(host, "Remote branch name"), "topic");
    await flush();

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Set as upstream"]')?.checked).toBe(false);
    submit(host)?.click();
    await flush();

    expect(calls).toEqual([["push_to", { remote: "backup", name: "topic", set_upstream: false }]]);
  });

  it("refuses an empty name or one with spaces", async () => {
    const { host } = mountPushTo();
    await flush();

    type(input(host, "Remote branch name"), "");
    await flush();
    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("Enter a branch name");
    type(input(host, "Remote branch name"), "my topic");
    await flush();
    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("A branch name cannot contain spaces");
  });
});

describe("rename stash form", () => {
  const stash = { index: 1, sha: "s1", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: half done", time: 0 };

  function mountRename(message = stash.message) {
    const { calls, actions } = actionsStub();
    const state = { kind: "rename_stash", anchor, stash: { ...stash, message } } as Extract<PopoverState, { kind: "rename_stash" }>;
    const mounted = mountWithApp(() => <RenameStashForm state={state} actions={actions} />);
    dispose = mounted.dispose;
    return { ...mounted, calls };
  }

  it("starts from the message without git's branch prefix and renames with the new text", async () => {
    const { host, calls } = mountRename();
    await flush();

    expect(input(host, "Stash message")?.value).toBe("half done");
    expect(submit(host)?.disabled).toBe(true);
    type(input(host, "Stash message"), "nearly done");
    await flush();
    submit(host)?.click();
    await flush();

    expect(calls).toEqual([["rename_stash", 1, "nearly done"]]);
  });

  it("strips the WIP prefix and refuses an empty message", async () => {
    const { host } = mountRename("WIP on main: abc1234 Subject");
    await flush();

    expect(input(host, "Stash message")?.value).toBe("abc1234 Subject");
    type(input(host, "Stash message"), "  ");
    await flush();
    expect(submit(host)?.disabled).toBe(true);
    expect(reason(host)).toBe("Enter a name for the stash");
  });
});
