# Changelog

## [0.3.4] - 2026-10-09

The v0.3.3 tag did not produce a published release. This release includes its changes.

### Fixed
+ Linked worktrees located inside the repository (for example under `.worktrees/`) no longer appear as untracked changes or count toward the change totals, and Stage all no longer stages them as embedded repositories.

## [0.3.2] - 2026-10-08

### Added
+ Pull request compose view replaces the create-pull-request dialog, with branch comparison, incoming commits, and PR checks for the selected branch.
+ AI-drafted pull request titles and bodies from the branch context.
+ Merge prediction that forecasts conflicting files before a pull request is created or a branch is published.

### Changed
+ Views swap with a fade-out of the held content while the replacement appears immediately.
+ Pending indicators appear after 150ms and remain for at least 400ms; commit details and workspace loading show skeleton screens.
+ Publish accepts a target branch and shows richer status labels.

### Fixed
+ Cached repository tabs stay visible while asynchronous reads run, and viewport reads queued during a failed graph refresh resume afterward.
+ Graph column width limits follow the rendered lanes rather than off-screen cached history, and saved widths are preserved.

## [0.3.1] - 2026-10-07

The v0.3.0 tag did not produce a published release. This release includes its changes and the additional virtual-list fix below.

### Added
+ Eight additional themes: Classic Dark, Ocean, Eighties, Gruvbox, Nord, Dracula, Monokai, and Woodland, selected from the Theme dropdown in Settings.
+ Vim mode in the file editor and support for explicitly starting configured, installed language servers, with definition and reference navigation.
+ Image, rendered Markdown, and sandboxed HTML previews from the selected revision, with Source view for Markdown and HTML.
+ AI message drafts for Amend and Edit message on HEAD, with cancellation and Restore my text.

### Changed
+ Push and Publish are split buttons with a Push to… target picker; commit inspector actions use compact icon controls with named tooltips.
+ Repository tabs no longer display the YForge mark; linked worktree tabs retain their worktree glyph.
+ Graph rows show lane-tinted bands and the first nonblank commit-body line beside the summary. The graph column defaults to 56px, grows for active lanes, and can be resized with its width saved per repository.
+ Blame highlights lines belonging to the selected commit.
+ UI text is larger, and long repository and branch names truncate without hiding toolbar actions.
+ Settings, repository dialogs, and the composer show busy feedback and guard against overlapping submissions. Composer fields and busy icon controls stay within their panels.
+ The macOS app icon uses a smaller mark inside the existing rounded plate and transparent margin.

### Fixed
+ Virtual file lists reconcile their rendered window when focus changes after an implicit native scroll-offset reset, preventing an off-screen range from leaving the Changes list blank.
+ Returning to a repository tab displays its cached graph while refresh runs; refreshing a shortened history no longer leaves visible pages blank.
+ Returning from Diff to Graph restores visible rows after scrolling.
+ Commit details and changed-file lists no longer fail when a worktree filename matches the requested commit ID or an empty-tree ID.
+ Invalid or unreadable launch folders now show a notice without blocking startup or losing saved tabs. A folder that stops being a Git repository shows the invalid-folder state instead of stale Git actions.
+ Repositories without commits keep the first-commit action visible while their file list scrolls, support keyboard navigation, and no longer label staged files as untracked.
+ Settings text fields retain typed values while a save is pending or refused.

---

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
