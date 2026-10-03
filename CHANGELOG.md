# Changelog

## [0.2.0] - 2026-10-03

### Added
+ The Launchpad is the landing screen and the New tab page, with a Repositories tab that lists every repository YForge knows, with its branch and status.
    + Add folder… scans a folder for Git repositories; scanned folders can be rescanned or stopped, and a repository can be removed from the list with Undo.
    + Open…, Clone…, and Create… sit in its header, and a folder dropped on it opens as a repository.
+ Settings has a search field that finds any setting, a Repositories section for scanned folders, and an External tools section.
+ External tools: choose an external merge tool, diff tool, and editor from the tools installed on the Mac, Git's configured tool, or a custom editor command.
    + Open in editor, Open in external diff tool, and Open in external merge tool on file rows, diffs, and conflicted files.
    + ⇧⌘E opens the repository in the external editor.
+ ⇧⌘O opens a repository search in the command palette.
+ The command palette covers the GitKraken palette: zoom (⌘=, ⌘−, ⌘0), Toggle sidebar (⌘\), Toggle inspector (⌥⌘\), Toggle syntax highlighting, Toggle theme, keyboard shortcuts, history and blame of any file, annotated tags, file create, delete, view, and edit, patches, repository maintenance, and the activity, error, and performance logs.
+ Redo, from the toolbar, the palette, and ⇧⌘Z, re-applies what the last Undo reverted.
+ File history and blame for any file, opened from a diff or a commit's files, with Revert hunk.
+ A Merge Tool for conflicts: Yours and Theirs side by side, take either side per conflict, previous and next conflict, and an editable result.
+ Multi-select in the Unstaged, Untracked, and Staged lists, with Stage, Discard, Ignore, and Stash for the selected files and Create patch from their changes.
+ A Path or Tree view for every file list, and Stage, Unstage, Stash, and Discard for a whole folder from its menu.
+ Git hooks in the sidebar: View, Run, and Test each hook. Test runs it in a temporary worktree and leaves the repository unchanged.
+ Git Flow: initialize it in Settings, then start and finish features, releases, and hotfixes from the sidebar, with Undo.
+ Git LFS settings: initialize LFS for a repository and track or untrack patterns.
+ Commit signing settings for OpenPGP, SSH, or X.509 keys, for all repositories or one.
+ Profiles, each with its own author name, email, and open tabs. YForge's commits use the active profile's author without changing your Git config.
+ AI features: explain changes, explain a commit, compose commits from your changes, and generate a stash message.
+ Submodules in the sidebar: list, add, update, deinit, and stage them.
+ Tabs can be dragged to reorder them within and across tab groups.

### Changed
+ A new solid charcoal look in both themes, with no gradient background.
+ The Changes panel is icon-driven, with Commit and Stash tabs in the composer.
+ AI actions are icon buttons with tooltips.
+ The toolbar has separate Fetch, Pull, and Push controls instead of one Sync menu.
+ Worktrees sits directly under Remotes in the sidebar, and the sidebar tree uses plain vertical guides.
+ The app icon sits on the same rounded plate with a margin as the other Y apps.
+ Right-clicking anywhere opens YForge's own menu or nothing; the browser menu no longer appears.

### Fixed
+ YForge asked for the macOS Keychain password on every AI request or fetch. It now reads each stored key, token, and SSH passphrase once per launch.
+ Diff line colors now reach the end of long lines.
+ Collapsing a tab group now hides every tab in it, including the open repository.

---
