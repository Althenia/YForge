use yforge_core::{PullOutcome, PullStash, RebaseOutcome};

pub fn leaf(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}

pub fn patch_created(destination: &str) -> String {
    format!("Created patch {}", leaf(destination))
}

pub fn patch_applied(patch: &str) -> String {
    format!("Applied patch {}", leaf(patch))
}

pub fn pulled(outcome: PullOutcome) -> String {
    match outcome {
        PullOutcome::UpToDate => "Already up to date",
        PullOutcome::Updated => "Pulled new commits",
        PullOutcome::Conflicts => "Pull stopped on conflicts",
    }
    .to_owned()
}

pub fn pulled_with_stash(outcome: PullOutcome, stash: &PullStash) -> String {
    let base = pulled(outcome);
    match stash {
        PullStash::None => base,
        PullStash::Restored if outcome == PullOutcome::Conflicts => base,
        PullStash::Restored => format!("{base} and restored the stash"),
        PullStash::Kept { .. } => format!("{base}; stash kept"),
    }
}

pub fn stepped(done: &str, verb: &str, conflicted: bool) -> String {
    if conflicted {
        format!("{verb} stopped on conflicts")
    } else {
        done.to_owned()
    }
}

pub fn rewritten(done: &str, verb: &str, outcome: RebaseOutcome) -> String {
    match outcome {
        RebaseOutcome::Completed => done.to_owned(),
        RebaseOutcome::Conflicts => format!("{verb} stopped on conflicts"),
        RebaseOutcome::StoppedToEdit => format!("{verb} paused to edit a commit"),
    }
}

pub fn worktree_created(branch: &str) -> String {
    format!("Created worktree {branch}")
}

pub fn worktree_removed(worktree: &str) -> String {
    format!("Removed worktree {}", leaf(worktree))
}

pub fn worktree_conflicts(worktree: &str) -> String {
    format!("Rebase stopped on conflicts in {}", leaf(worktree))
}

pub fn undone(operation: &str) -> String {
    format!("Undid {operation}")
}

pub fn redone(operation: &str) -> String {
    format!("Redid {operation}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEEP: &str = "/Users/viadz/Workspace/Project/ycoding/.worktrees/performance-analysis";

    #[test]
    fn leaf_names_the_last_segment_of_a_path() {
        assert_eq!(leaf(DEEP), "performance-analysis");
        assert_eq!(leaf("/Users/viadz/repo/"), "repo");
        assert_eq!(leaf("src/state/app.ts"), "app.ts");
        assert_eq!(leaf("C:\\Users\\viadz\\repo"), "repo");
        assert_eq!(leaf("README.md"), "README.md");
    }

    #[test]
    fn patch_labels_name_the_file_only() {
        assert_eq!(
            patch_created("/Users/viadz/Desktop/fix-login.patch"),
            "Created patch fix-login.patch"
        );
        assert_eq!(
            patch_applied("/Users/viadz/Downloads/fix-login.patch"),
            "Applied patch fix-login.patch"
        );
    }

    #[test]
    fn pull_labels_state_the_outcome_in_words() {
        assert_eq!(pulled(PullOutcome::UpToDate), "Already up to date");
        assert_eq!(pulled(PullOutcome::Updated), "Pulled new commits");
        assert_eq!(pulled(PullOutcome::Conflicts), "Pull stopped on conflicts");
        assert_eq!(
            pulled_with_stash(PullOutcome::Updated, &PullStash::None),
            "Pulled new commits"
        );
        assert_eq!(
            pulled_with_stash(PullOutcome::Updated, &PullStash::Restored),
            "Pulled new commits and restored the stash"
        );
        assert_eq!(
            pulled_with_stash(
                PullOutcome::Conflicts,
                &PullStash::Kept {
                    reference: "stash@{0}".to_owned(),
                    sha: "abc".to_owned(),
                    reason: yforge_core::StashKeptReason::PullConflicts,
                }
            ),
            "Pull stopped on conflicts; stash kept"
        );
    }

    #[test]
    fn step_labels_state_whether_the_operation_stopped() {
        assert_eq!(
            stepped("Continued the operation", "Continue", false),
            "Continued the operation"
        );
        assert_eq!(
            stepped("Skipped the step", "Skip", true),
            "Skip stopped on conflicts"
        );
    }

    #[test]
    fn rewrite_labels_state_the_outcome_in_words() {
        assert_eq!(
            rewritten("Squashed 3 commits", "Squash", RebaseOutcome::Completed),
            "Squashed 3 commits"
        );
        assert_eq!(
            rewritten("Squashed 3 commits", "Squash", RebaseOutcome::Conflicts),
            "Squash stopped on conflicts"
        );
        assert_eq!(
            rewritten("Rewrote history", "Rewrite", RebaseOutcome::StoppedToEdit),
            "Rewrite paused to edit a commit"
        );
    }

    #[test]
    fn worktree_labels_name_the_branch_or_folder_never_the_path() {
        assert_eq!(
            worktree_created("performance-analysis"),
            "Created worktree performance-analysis"
        );
        assert_eq!(
            worktree_removed(DEEP),
            "Removed worktree performance-analysis"
        );
        assert_eq!(
            worktree_conflicts(DEEP),
            "Rebase stopped on conflicts in performance-analysis"
        );
    }

    #[test]
    fn undo_and_redo_name_the_operation_without_the_core_message() {
        assert_eq!(undone("Deleted branch topic"), "Undid Deleted branch topic");
        assert_eq!(redone("Deleted branch topic"), "Redid Deleted branch topic");
    }
}
