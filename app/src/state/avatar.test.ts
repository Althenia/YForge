import { describe, expect, it } from "vitest";
import { avatarsEnabled, avatarInitial } from "./avatar";

describe("author initial", () => {
  it("uses the first letter of the name, upper-cased, and a question mark for no name", () => {
    expect(avatarInitial("yui")).toBe("Y");
    expect(avatarInitial("  Étienne")).toBe("É");
    expect(avatarInitial("")).toBe("?");
  });
});

describe("avatar preference", () => {
  it("is on unless the saved setting turns it off", () => {
    expect(avatarsEnabled(undefined)).toBe(true);
    expect(avatarsEnabled({ gravatar_avatars: true } as never)).toBe(true);
    expect(avatarsEnabled({ gravatar_avatars: false } as never)).toBe(false);
  });
});
