import { describe, expect, it } from "vitest";
import { gravatarEnabled, gravatarUrl, initialOf, md5Hex, setGravatarEnabled } from "./avatar";

describe("md5", () => {
  it("matches the reference digests, including multi-block and non-ASCII input", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("ünï@example.com")).toBe("fcf2efc5cdabd257a211ecc585701bd7");
    expect(md5Hex("The quick brown fox jumps over the lazy dog, and then it does so again until the sun has long set.")).toBe("e5b4fca34a639cdbd772071c11a81bbd");
  });
});

describe("gravatar address", () => {
  it("hashes the trimmed, lower-cased email and sends nothing else", () => {
    const url = gravatarUrl("  MyEmail@Example.com ");

    expect(url).toBe("https://www.gravatar.com/avatar/60a6c20d49f49bc210ac98d7e47c74a0?s=48&d=identicon");
    expect(url).not.toContain("example.com");
  });
});

describe("author initial", () => {
  it("uses the first letter of the name, upper-cased, and a question mark for no name", () => {
    expect(initialOf("yui")).toBe("Y");
    expect(initialOf("  Étienne")).toBe("É");
    expect(initialOf("")).toBe("?");
  });
});

describe("gravatar preference", () => {
  it("is on by default and can be switched off and on", () => {
    expect(gravatarEnabled()).toBe(true);
    setGravatarEnabled(false);
    expect(gravatarEnabled()).toBe(false);
    setGravatarEnabled(true);
    expect(gravatarEnabled()).toBe(true);
  });
});
