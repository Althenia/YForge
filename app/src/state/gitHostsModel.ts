import type { GitHost } from "../ipc/bindings/GitHost";
import type { UrlIdentity } from "../ipc/bindings/UrlIdentity";

export const SSH_AGENT_TEXT = "your SSH agent and ~/.ssh/config";

export const CREDENTIAL_HELPER_TEXT = "the password or token comes from the macOS Keychain, or YForge asks once and can save it there.";

export const IDENTITY_ORDER = [
  "The repository's own SSH key (Repository settings)",
  "The identity whose host matches the remote URL",
  "The app-wide SSH key (General)",
  "Your SSH agent and ~/.ssh/config",
] as const;

export const tildePath = (path: string, home: string | undefined): string => {
  if (home === undefined || home === "") return path;
  const root = home.endsWith("/") ? home.slice(0, -1) : home;
  return path === root ? "~" : path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
};

export const shortFingerprint = (fingerprint: string): string => {
  const [scheme, body] = fingerprint.includes(":") ? (fingerprint.split(/:(.*)/s) as [string, string]) : ["", fingerprint];
  const shown = body.length > 10 ? `${body.slice(0, 4)}…${body.slice(-3)}` : body;
  return scheme === "" ? shown : `${scheme}:${shown}`;
};

export type KeyLine = { path: string; detail: string | undefined } | undefined;

export function keyLine(host: Pick<GitHost, "ssh_key_path" | "key_kind" | "key_fingerprint">, home: string | undefined): KeyLine {
  if (host.ssh_key_path === null) return undefined;
  const parts = [host.key_kind, host.key_fingerprint === null ? null : shortFingerprint(host.key_fingerprint)].filter((part): part is string => part !== null);
  return { path: tildePath(host.ssh_key_path, home), detail: parts.length === 0 ? undefined : parts.join(" · ") };
}

export type IdentityLine = {
  heading: string;
  detail: { kind: "path"; path: string } | { kind: "https"; user: string | null } | { kind: "text"; text: string } | undefined;
  hostIdentity: boolean;
};

export function identityLine(identity: UrlIdentity, home: string | undefined): IdentityLine {
  if (identity.transport === "other") return { heading: "No identity is used", detail: { kind: "text", text: "A local path or a git:// address needs no credentials." }, hostIdentity: false };
  if (identity.source === "host") {
    const heading = `Uses the ${identity.host} identity`;
    if (identity.transport === "https") return { heading, detail: { kind: "https", user: identity.https_user }, hostIdentity: true };
    return {
      heading,
      detail: identity.ssh_key_path === null ? { kind: "text", text: `SSH with ${SSH_AGENT_TEXT}` } : { kind: "path", path: tildePath(identity.ssh_key_path, home) },
      hostIdentity: true,
    };
  }
  if (identity.transport === "https") return { heading: "No host identity matches", detail: { kind: "https", user: null }, hostIdentity: false };
  if (identity.source === "app" && identity.ssh_key_path !== null) return { heading: "Uses the app-wide SSH key", detail: { kind: "path", path: tildePath(identity.ssh_key_path, home) }, hostIdentity: false };
  return { heading: `Uses ${SSH_AGENT_TEXT}`, detail: undefined, hostIdentity: false };
}
