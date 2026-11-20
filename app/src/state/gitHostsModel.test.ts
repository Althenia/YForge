import { describe, expect, it } from "vitest";
import type { UrlIdentity } from "../ipc/bindings/UrlIdentity";
import { GIT_HOST_PROVIDERS, identityLine, keyLine, shortFingerprint, SIGN_IN_METHODS, signInStatus, tildePath } from "./gitHostsModel";

const identity = (overrides: Partial<UrlIdentity>): UrlIdentity => ({ transport: "ssh", source: "agent", host: null, ssh_key_path: null, https_user: null, ...overrides });

describe("Git hosts model", () => {
  it("abbreviates the home folder only at a path boundary", () => {
    expect(tildePath("/Users/you/.ssh/id_corp_b", "/Users/you")).toBe("~/.ssh/id_corp_b");
    expect(tildePath("/Users/you2/.ssh/id", "/Users/you")).toBe("/Users/you2/.ssh/id");
    expect(tildePath("/Users/you", "/Users/you/")).toBe("~");
    expect(tildePath("/keys/id", undefined)).toBe("/keys/id");
  });

  it("shortens a fingerprint to its first four and last three characters", () => {
    expect(shortFingerprint("SHA256:q4VdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAT1o")).toBe("SHA256:q4Vd…T1o");
    expect(shortFingerprint("SHA256:abc")).toBe("SHA256:abc");
  });

  it("describes a key by its path, kind, and fingerprint, and a keyless identity as none", () => {
    expect(keyLine({ ssh_key_path: "/Users/you/.ssh/yforge_a", key_kind: "ed25519", key_fingerprint: "SHA256:q4VdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAT1o" }, "/Users/you")).toEqual({
      path: "~/.ssh/yforge_a",
      detail: "ed25519 · SHA256:q4Vd…T1o",
    });
    expect(keyLine({ ssh_key_path: "/k/id", key_kind: null, key_fingerprint: null }, undefined)).toEqual({ path: "/k/id", detail: undefined });
    expect(keyLine({ ssh_key_path: null, key_kind: null, key_fingerprint: null }, undefined)).toBeUndefined();
  });

  it("states the identity an SSH or HTTPS URL will use, or the agent when none matches", () => {
    expect(identityLine(identity({ source: "host", host: "gitlab.corp-b.com:2222", ssh_key_path: "/Users/you/.ssh/id_corp_b" }), "/Users/you")).toEqual({
      heading: "Uses the gitlab.corp-b.com:2222 identity",
      detail: { kind: "path", path: "~/.ssh/id_corp_b" },
      hostIdentity: true,
    });
    expect(identityLine(identity({ source: "host", host: "github.com" }), undefined).detail).toEqual({ kind: "text", text: "SSH with your SSH agent and ~/.ssh/config" });
    expect(identityLine(identity({ transport: "https", source: "host", host: "gitlab.corp-a.com", https_user: "you" }), undefined)).toEqual({
      heading: "Uses the gitlab.corp-a.com identity",
      detail: { kind: "https", user: "you" },
      hostIdentity: true,
    });
    expect(identityLine(identity({ source: "app", ssh_key_path: "/k/app" }), undefined)).toEqual({ heading: "Uses the app-wide SSH key", detail: { kind: "path", path: "/k/app" }, hostIdentity: false });
    expect(identityLine(identity({}), undefined)).toEqual({ heading: "Uses your SSH agent and ~/.ssh/config", detail: undefined, hostIdentity: false });
    expect(identityLine(identity({ transport: "https" }), undefined).heading).toBe("No host identity matches");
    expect(identityLine(identity({ transport: "other" }), undefined).heading).toBe("No identity is used");
  });

  it("states a host's sign-in as the login and method, or signed out", () => {
    expect(signInStatus({ provider: "github", method: "oauth", login: "octo" })).toBe("Signed in as octo · OAuth");
    expect(signInStatus({ provider: "gitlab", method: "web", login: "you" })).toBe("Signed in as you · Web sign-in");
    expect(signInStatus({ provider: "bitbucket", method: "token", login: "bb" })).toBe("Signed in as bb · Token");
    expect(signInStatus(null)).toBe("Signed out");
  });

  it("labels every sign-in method and provider", () => {
    expect(Object.values(SIGN_IN_METHODS).map((method) => method.label)).toEqual(["OAuth", "Web sign-in", "Token"]);
    expect(GIT_HOST_PROVIDERS.map((provider) => provider.label)).toEqual(["GitHub", "GitLab", "Bitbucket", "Gitea"]);
  });
});
