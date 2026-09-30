import { describe, expect, it } from "vitest";
import { bareStashMessage } from "./stashName";

describe("stash names", () => {
  it("drops git's branch prefix and keeps the message", () => {
    expect(bareStashMessage("On main: half done")).toBe("half done");
    expect(bareStashMessage("WIP on feature/x: abc1234 Subject: more")).toBe("abc1234 Subject: more");
    expect(bareStashMessage("custom")).toBe("custom");
  });
});
