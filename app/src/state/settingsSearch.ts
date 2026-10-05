import { FEATURE_BLURBS, FEATURE_ORDER, FEATURE_TITLES } from "./aiFeatures";
import { SETTINGS_SECTIONS } from "./palette";

/// One searchable setting: where it lives, and the element that takes focus when a result is chosen.
export type SettingEntry = { id: string; section: string; group: string; title: string; note: string };

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  { id: "merge-tool", section: "tools", group: "External tools", title: "External merge tool", note: "Opens a conflicted file: None, the Git config default, FileMerge, Kaleidoscope, Beyond Compare, P4Merge, Sublime Merge, or Visual Studio Code." },
  { id: "diff-tool", section: "tools", group: "External tools", title: "External diff tool", note: "Opens a file's changes: the merge tool, None, the Git config default, or any tool found on this Mac." },
  { id: "editor", section: "tools", group: "External tools", title: "External editor", note: "Opens the repository or a file: None, Custom, Visual Studio Code, Cursor, Zed, Sublime Text, Xcode, IntelliJ IDEA, Nova, BBEdit, or TextMate." },
  { id: "terminal", section: "tools", group: "External tools", title: "External terminal", note: "Command that opens a repository or worktree folder." },
  { id: "language-servers", section: "tools", group: "External tools", title: "Language servers", note: "Installed commands for LSP diagnostics and editing tools, configured per file extension." },
  { id: "cli", section: "general", group: "Command line", title: "Command line", note: "Install the yforge command in ~/.local/bin so yforge <path> opens a repository." },
  { id: "profiles", section: "general", group: "Profiles", title: "Profiles", note: "Named author identities: add, rename, delete, or switch profile; each keeps its own open tabs." },
  { id: "identity-name", section: "git", group: "Identity", title: "Name", note: "Written on commits in every repository." },
  { id: "identity-email", section: "git", group: "Identity", title: "Email", note: "Written on commits in every repository." },
  { id: "default-branch", section: "git", group: "Defaults", title: "Default branch", note: "Name of the first branch in repositories you create." },
  { id: "pull-mode", section: "git", group: "Defaults", title: "Pull mode", note: "Strategy used by Pull: merge, rebase, or fast-forward only." },
  { id: "auto-fetch", section: "git", group: "Defaults", title: "Auto-fetch", note: "Fetch every remote in the background." },
  { id: "ssh-key", section: "git", group: "SSH", title: "SSH key", note: "Key used for every repository that has no key of its own; ssh-agent by default." },
  { id: "signing-scope", section: "git", group: "Commit signing", title: "Apply signing to", note: "Choose the global Git config or this repository's Git config." },
  { id: "sign-commits", section: "git", group: "Commit signing", title: "Sign commits", note: "Sign every commit YForge makes (commit.gpgSign)." },
  { id: "sign-tags", section: "git", group: "Commit signing", title: "Sign tags", note: "Sign every tag YForge makes (tag.gpgSign)." },
  { id: "signing-format", section: "git", group: "Commit signing", title: "Signing format", note: "OpenPGP, SSH, or X.509 (gpg.format)." },
  { id: "signing-key", section: "git", group: "Commit signing", title: "Signing key", note: "A secret OpenPGP key or a public key in ~/.ssh, or a custom value (user.signingkey)." },
  { id: "signing-program", section: "git", group: "Commit signing", title: "Signing program", note: "The program that signs (gpg.program); empty uses Git's default." },
  { id: "scanned-folders", section: "repositories", group: "Scanned folders", title: "Scanned folders", note: "Folders YForge scans for Git repositories: add, rescan, or stop scanning a folder." },
  { id: "listed-repositories", section: "repositories", group: "Listed repositories", title: "Repositories in the Launchpad", note: "Every repository you opened or YForge found in a scanned folder." },
  { id: "lfs", section: "repository", group: "Git LFS", title: "Git LFS", note: "Whether git-lfs is installed, initialize LFS in this repository, and track or untrack file patterns in .gitattributes." },
  { id: "git-flow", section: "repository", group: "Git Flow", title: "Git Flow", note: "Initialize Git Flow: production and development branches, the feature, release, and hotfix prefixes, and the version tag prefix." },
  { id: "theme", section: "appearance", group: "Appearance", title: "Theme", note: "Choose a named theme, or follow the system." },
  { id: "density", section: "appearance", group: "Appearance", title: "Density", note: "Compact or default graph lanes." },
  { id: "ai-sent", section: "ai", group: "What is sent", title: "What is sent", note: "What leaves this Mac when you press an AI button, and to whom." },
  { id: "ai-providers", section: "ai", group: "Providers", title: "Providers", note: "OpenAI, OpenRouter, Claude Code, and other providers: API keys and sign-in." },
  ...FEATURE_ORDER.map((feature) => ({ id: `ai-${feature}`, section: "ai", group: "Per-feature settings", title: FEATURE_TITLES[feature], note: FEATURE_BLURBS[feature] })),
  { id: "platform-connections", section: "platforms", group: "Connections", title: "Platform connections", note: "GitHub, GitLab, and Bitbucket, including self-managed servers, for pull requests." },
  { id: "jira", section: "jira", group: "Jira", title: "Jira site", note: "Connect Jira Cloud or Data Center to see the issues assigned to you." },
  { id: "git-hosts", section: "git-hosts", group: "Git hosts", title: "Host identities", note: "Per-host SSH key, HTTPS username, and Generate key." },
  { id: "gravatar", section: "privacy", group: "Profile pictures", title: "Show profile pictures from Gravatar", note: "Ask gravatar.com for each author's picture." },
  { id: "usage", section: "privacy", group: "Usage data", title: "Record usage data", note: "Record operations on this Mac only; nothing leaves it." },
  { id: "crashes", section: "privacy", group: "Crash reports", title: "Crash reports", note: "Crash reports kept on this Mac: export or clear." },
  { id: "activity-history", section: "privacy", group: "Activity history", title: "Activity history", note: "The Activity drawer's history kept on this Mac: clear it." },
];

const sectionLabel = (id: string): string => SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? id;

export const crumb = (entry: SettingEntry): string => (entry.group === sectionLabel(entry.section) ? sectionLabel(entry.section) : `${sectionLabel(entry.section)} › ${entry.group}`);

export function searchSettings(query: string, index: readonly SettingEntry[] = SETTINGS_INDEX): SettingEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  return index.filter((entry) => {
    const text = `${entry.title} ${entry.note} ${entry.group} ${sectionLabel(entry.section)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function matchCounts(results: readonly SettingEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of results) counts[entry.section] = (counts[entry.section] ?? 0) + 1;
  return counts;
}

export const settingAnchor = (id: string): string => `setting-${id}`;
