import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "../ipc/client";
import { createSearch, SEARCH_DELAY_MS } from "./search";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  clearMocks();
});

function install(rows: number[], total = 40) {
  const queries: string[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "search_commits") return null;
    queries.push((args as { query: string }).query);
    return { rows, total };
  });
  return queries;
}

const revealed: number[] = [];
beforeEach(() => {
  revealed.length = 0;
});

describe("search store", () => {
  it("waits for a pause in typing, searches once, and lands on the first match", async () => {
    const queries = install([3, 8, 21]);
    const search = createSearch((query) => client.searchCommits("/r", query), () => undefined, (row) => revealed.push(row));

    search.setQuery("f");
    search.setQuery("fi");
    search.setQuery("fix");
    expect(search.state().status).toBe("searching");
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);

    expect(queries).toEqual(["fix"]);
    expect(search.state()).toMatchObject({ status: "done", rows: [3, 8, 21], position: 0, total: 40 });
    expect(revealed).toEqual([3]);
  });

  it("steps forward and backward through the matches with wraparound and asks the graph to reveal each", async () => {
    install([3, 8, 21]);
    const search = createSearch((query) => client.searchCommits("/r", query), () => undefined, (row) => revealed.push(row));
    search.setQuery("fix");
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);

    search.next();
    expect([search.state().position, revealed.at(-1)]).toEqual([1, 8]);
    search.next();
    search.next();
    expect(search.state().position).toBe(0);
    search.previous();
    expect([search.state().position, revealed.at(-1)]).toEqual([2, 21]);
  });

  it("ignores stepping while nothing matches and clears the state when the query is emptied", async () => {
    install([]);
    const search = createSearch((query) => client.searchCommits("/r", query), () => undefined, (row) => revealed.push(row));
    search.setQuery("zzz");
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);

    search.next();
    expect(search.state().position).toBe(0);
    expect(revealed).toEqual([]);
    search.setQuery("");
    expect(search.state()).toMatchObject({ query: "", rows: [], status: "idle" });
  });

  it("discards the result of a superseded query", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockIPC((cmd, args) => {
      if (cmd !== "search_commits") return null;
      const query = (args as { query: string }).query;
      return query === "old" ? new Promise((resolve) => (release = resolve)) : { rows: [1], total: 5 };
    });
    const search = createSearch((query) => client.searchCommits("/r", query), () => undefined, (row) => revealed.push(row));
    search.setQuery("old");
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);
    search.setQuery("new");
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);
    release({ rows: [9, 9, 9], total: 5 });
    await vi.advanceTimersByTimeAsync(0);

    expect(search.state()).toMatchObject({ query: "new", rows: [1] });
  });

  it("reports a failed search and returns to idle; closing resets everything", async () => {
    const failures: unknown[] = [];
    mockIPC(() => {
      throw { kind: "git_failed", message: "boom", output: null };
    });
    const search = createSearch((query) => client.searchCommits("/r", query), (failure) => failures.push(failure), (row) => revealed.push(row));
    search.show();
    search.setQuery("x");
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);

    expect(failures).toHaveLength(1);
    expect(search.state().status).toBe("idle");
    search.close();
    expect(search.open()).toBe(false);
    expect(search.state().query).toBe("");
  });
});
