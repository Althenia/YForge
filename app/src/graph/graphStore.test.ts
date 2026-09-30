import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPage } from "../ipc/bindings/GraphPage";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import { createQueryClient } from "../state/queryClient";
import { createGraphStore } from "./graphStore";

afterEach(() => clearMocks());

const row = (sha: string | null, kind: GraphRow["kind"] = "commit"): GraphRow => ({
  sha,
  parents: [],
  summary: sha ?? "Changes",
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
      store.ensure(0, 10);
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
      store.ensure(0, 10);
      await store.refresh();
      fail = true;

      await store.refresh();

      expect(store.rows().get(0)?.sha).toBe("a");
      expect(store.error()?.message).toBe("boom");
      dispose();
    });
  });
});
