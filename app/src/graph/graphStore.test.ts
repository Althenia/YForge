import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createEffect, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexOfSelection, type Selection } from "../state/selection";
import type { GraphPage } from "../ipc/bindings/GraphPage";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import { createQueryClient } from "../state/queryClient";
import { repoKeys } from "../state/queryKeys";
import { visibilityKey } from "../state/repoUiPrefs";
import { createGraphStore, PAGE_SIZE } from "./graphStore";

afterEach(() => clearMocks());

const row = (sha: string | null, kind: GraphRow["kind"] = "commit"): GraphRow => ({
  sha,
  parents: [],
  summary: sha ?? "Changes",
  body: "",
  author: null,
  time: null,
  refs: [],
  kind,
  column: 0,
  edges: [{ lane: 0, parent_row: null, parent_column: null }],
});

const page = (...rows: GraphRow[]): GraphPage => ({ rows, carried: [], total: rows.length });

function install(pages: () => GraphPage) {
  const calls: unknown[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return pages();
  });
  return calls;
}

describe("graph store", () => {
  it("publishes the returning tab's cached graph synchronously without showing another repository or visibility", () => {
    const queryClient = createQueryClient();
    const chosen: GraphVisibility = { kind: "current_and_upstream" };
    queryClient.setQueryData(repoKeys.graph("/r", 0, visibilityKey(chosen)), page(row("cached-target")));
    queryClient.setQueryData(repoKeys.graph("/other", 0, visibilityKey(chosen)), page(row("other-repository")));
    queryClient.setQueryData(repoKeys.graph("/r", 0, visibilityKey({ kind: "all" })), page(row("other-visibility")));
    createRoot((dispose) => {
      const store = createGraphStore("/r", queryClient, () => chosen);
      store.ensure(0, 1);
      expect(store.total()).toBe(1);
      expect([...store.rows().values()].map((entry) => entry.sha)).toEqual(["cached-target"]);
      dispose();
    });
  });

  it("loads a requested page once and keeps its rows by index", async () => {
    const calls = install(() => page(row("a"), row("b")));
    await createRoot(async (dispose) => {
      const store = createGraphStore("/r", createQueryClient());
      store.ensure(0, 10);
      store.ensure(0, 10);
      await vi.waitFor(() => expect(store.total()).toBe(2));
      expect(store.rows().get(1)?.sha).toBe("b");
      dispose();
    });
    expect(calls).toEqual([{ cmd: "repo_graph", args: { path: "/r", offset: 0, limit: 200 } }]);
  });

  it("replaces every loaded row on refresh and drops rows that no longer exist", async () => {
    let current = page(row(null, "changes"), row("a"), row("b"));
    install(() => current);
    await createRoot(async (dispose) => {
      const store = createGraphStore("/r", createQueryClient());
      store.show(0, 10);
      await store.refresh();
      expect([...store.rows().values()].map((entry) => entry.sha)).toEqual([null, "a", "b"]);

      current = page(row("n"), row("a"));
      await store.refresh();

      expect(store.total()).toBe(2);
      expect([...store.rows().entries()].map(([index, entry]) => [index, entry.sha])).toEqual([
        [0, "n"],
        [1, "a"],
      ]);
      dispose();
    });
  });

  it("keeps the stale rows and reports the error when a refresh fails", async () => {
    let fail = false;
    mockIPC(() => {
      if (fail) throw { kind: "git_failed", message: "boom", output: null };
      return page(row("a"));
    });
    await createRoot(async (dispose) => {
      const store = createGraphStore("/r", createQueryClient());
      store.show(0, 10);
      await store.refresh();
      fail = true;

      await store.refresh();

      expect(store.rows().get(0)?.sha).toBe("a");
      expect(store.error()?.message).toBe("boom");
      dispose();
    });
  });

  it("resolves load only once every row of the range is in the layout", async () => {
    install(() => page(row("a"), row("b"), row("c")));
    await createRoot(async (dispose) => {
      const store = createGraphStore("/r", createQueryClient());
      expect(store.rows().size).toBe(0);

      await store.load(0, 3);

      expect([...store.rows().values()].map((entry) => entry.sha)).toEqual(["a", "b", "c"]);
      dispose();
    });
  });

  it("loads a viewport requested by readers when the refreshed layout is published", async () => {
    let total = 2000;
    const offsets: number[] = [];
    mockIPC((_cmd, args) => {
      const { offset, limit } = args as { offset: number; limit: number };
      offsets.push(offset);
      return { rows: Array.from({ length: Math.max(Math.min(limit, total - offset), 0) }, (_, index) => row(`sha${offset + index}`)), carried: [], total };
    });
    await createRoot(async (dispose) => {
      const store = createGraphStore("/r", createQueryClient());
      createEffect(() => {
        if (store.total() === 450) store.show(440, 450);
      });
      store.show(1500, 1540);
      await store.load(1500, 1540);
      total = 450;

      await store.refresh();

      await vi.waitFor(() => expect(store.rows().get(449)?.sha).toBe("sha449"));
      expect(offsets.filter((offset) => offset === 400)).toHaveLength(1);
      dispose();
    });
  });

  describe("with a long history", () => {
    const PAGES = 500;
    const TOTAL = PAGES * PAGE_SIZE;
    const commit = (version: number, index: number): GraphRow => row(`v${version}-${index}`);

    function installHistory(version: () => number) {
      const offsets: number[] = [];
      mockIPC((_cmd, args) => {
        const { offset, limit } = args as { offset: number; limit: number };
        offsets.push(offset);
        const count = Math.max(Math.min(limit, TOTAL - offset), 0);
        return { rows: Array.from({ length: count }, (_, position) => commit(version(), offset + position)), carried: [], total: TOTAL };
      });
      return offsets;
    }

    it("refetches only the pages around the viewport after the whole history was browsed", async () => {
      let version = 0;
      const offsets = installHistory(() => version);
      await createRoot(async (dispose) => {
        const store = createGraphStore("/r", createQueryClient());
        await store.load(0, TOTAL);
        expect(store.rows().size).toBe(TOTAL);
        store.show(250 * PAGE_SIZE + 20, 250 * PAGE_SIZE + 60);
        offsets.length = 0;
        version = 1;

        await store.refresh();

        expect(offsets.length).toBeLessThanOrEqual(4);
        expect(offsets).toContain(250 * PAGE_SIZE);
        expect(store.total()).toBe(TOTAL);
        dispose();
      });
    });

    it("lays the visible rows out from the fresh data and drops the pages far from the viewport", async () => {
      let version = 0;
      installHistory(() => version);
      await createRoot(async (dispose) => {
        const store = createGraphStore("/r", createQueryClient());
        await store.load(0, TOTAL);
        const first = 250 * PAGE_SIZE + 20;
        store.show(first, first + 40);
        version = 1;

        await store.refresh();

        for (let index = first; index < first + 40; index++) expect(store.rows().get(index)?.sha).toBe(`v1-${index}`);
        expect(store.rows().has(0)).toBe(false);
        expect(store.rows().size).toBeLessThanOrEqual(5 * PAGE_SIZE);
        dispose();
      });
    });

    it("loads a dropped page again when it scrolls back into view", async () => {
      let version = 0;
      const offsets = installHistory(() => version);
      await createRoot(async (dispose) => {
        const store = createGraphStore("/r", createQueryClient());
        await store.load(0, TOTAL);
        store.show(250 * PAGE_SIZE, 250 * PAGE_SIZE + 40);
        version = 1;
        await store.refresh();
        offsets.length = 0;

        store.show(0, 40);
        await vi.waitFor(() => expect(store.rows().get(0)?.sha).toBe("v1-0"));

        expect(offsets).toEqual([0]);
        dispose();
      });
    });

    it("keeps the selected commit and every commit of a multi-selection laid out after a refresh", async () => {
      const offsets = installHistory(() => 0);
      await createRoot(async (dispose) => {
        const selection: Selection = { kind: "commit", sha: "v0-2010", anchor: "v0-2010", shas: ["v0-2010", "v0-3000"] };
        const store = createGraphStore("/r", createQueryClient(), undefined, () => selection);
        await store.load(0, TOTAL);
        store.show(250 * PAGE_SIZE, 250 * PAGE_SIZE + 40);
        offsets.length = 0;

        await store.refresh();

        expect(indexOfSelection(store.rows(), { kind: "commit", sha: "v0-2010" })).toBe(2010);
        expect(indexOfSelection(store.rows(), { kind: "commit", sha: "v0-3000" })).toBe(3000);
        expect(offsets.length).toBeLessThanOrEqual(6);
        dispose();
      });
    });

    it("does not copy the loaded rows for every page and still notifies readers when a page arrives", async () => {
      installHistory(() => 0);
      await createRoot(async (dispose) => {
        const store = createGraphStore("/r", createQueryClient());
        const seen: number[] = [];
        createEffect(() => seen.push(store.rows().size));
        await store.load(0, 3 * PAGE_SIZE);
        const before = store.rows();

        await store.load(10 * PAGE_SIZE, 11 * PAGE_SIZE);

        expect(store.rows() === before).toBe(true);
        expect(seen.at(-1)).toBe(4 * PAGE_SIZE);
        dispose();
      });
    });
  });

  it("asks the core for the chosen branch visibility and lays the history out again when it changes", async () => {
    const calls = install(() => page(row("a"), row("b")));
    await createRoot(async (dispose) => {
      let visibility: GraphVisibility = { kind: "all" };
      const store = createGraphStore("/r", createQueryClient(), () => visibility);
      store.show(0, 10);
      await vi.waitFor(() => expect(store.total()).toBe(2));

      visibility = { kind: "current_and_upstream" };
      await store.refresh();
      dispose();
    });

    expect(calls).toEqual([
      { cmd: "repo_graph", args: { path: "/r", offset: 0, limit: 200 } },
      { cmd: "repo_graph", args: { path: "/r", offset: 0, limit: 200, visibility: { kind: "current_and_upstream" } } },
    ]);
  });
});
