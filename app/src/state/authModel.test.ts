import { describe, expect, it } from "vitest";
import type { AuthPrompt } from "../ipc/bindings/AuthPrompt";
import { credentialsReply, dropOperationPrompts, dropPrompt, enqueuePrompt, promptCopy, rejectedNotice } from "./authModel";

const prompt = (extra: Partial<AuthPrompt> = {}): AuthPrompt => ({
  id: "op-1/auth-1",
  kind: "credentials",
  url: "https://github.com",
  host: "github.com",
  username: null,
  message: "github.com needs credentials.",
  fingerprint: null,
  ...extra,
});

describe("auth prompt model", () => {
  it("queues prompts in arrival order, replacing a re-sent prompt and dropping answered or cancelled ones", () => {
    const first = enqueuePrompt([], { operation: "op-1", prompt: prompt() });
    const second = enqueuePrompt(first, { operation: "op-2", prompt: prompt({ id: "op-2/auth-1" }) });
    expect(enqueuePrompt(second, { operation: "op-1", prompt: prompt() })).toHaveLength(2);
    expect(dropPrompt(second, "op-1/auth-1").map((pending) => pending.operation)).toEqual(["op-2"]);
    expect(dropOperationPrompts(second, "op-2").map((pending) => pending.operation)).toEqual(["op-1"]);
  });

  it("titles each prompt kind and names the waiting operation", () => {
    expect(promptCopy(prompt(), "fetch")).toMatchObject({ title: "HTTPS credentials", lead: "github.com needs credentials for fetch.", primary: "Fetch", icon: "lock" });
    expect(promptCopy(prompt({ kind: "passphrase", message: "Enter passphrase for key '/k/id': " }), "push")).toMatchObject({
      title: "SSH key passphrase",
      lead: "Enter passphrase for key '/k/id'.",
      primary: "Unlock key",
    });
    expect(promptCopy(prompt({ kind: "host_key", host: "example.test", fingerprint: "SHA256:abc" }), "clone")).toMatchObject({ title: "Confirm host key", primary: "Trust and continue", icon: "warning" });
  });

  it("builds a credentials reply only when the required fields are filled", () => {
    expect(credentialsReply(prompt(), { username: "", secret: "tok", save: true })).toBeUndefined();
    expect(credentialsReply(prompt(), { username: "yui", secret: "", save: true })).toBeUndefined();
    expect(credentialsReply(prompt(), { username: " yui ", secret: "tok", save: true })).toEqual({ kind: "credentials", username: "yui", secret: "tok", save: true });
    expect(credentialsReply(prompt({ username: "fixed" }), { username: "", secret: "tok", save: false })).toEqual({ kind: "credentials", username: "fixed", secret: "tok", save: false });
  });

  it("answers a passphrase prompt with the secret only and never asks to save it", () => {
    expect(credentialsReply(prompt({ kind: "passphrase" }), { username: "", secret: "open sesame", save: true })).toEqual({
      kind: "credentials",
      username: null,
      secret: "open sesame",
      save: false,
    });
  });

  it("explains a rejected credential", () => {
    expect(rejectedNotice("github.com")).toContain("github.com rejected the credentials");
    expect(rejectedNotice(null)).toContain("The remote rejected");
  });
});
