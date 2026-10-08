mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use common::Fixture;
use yforge_core::{
    branch_comparison, pull_request_context, pull_request_template, CancelToken, MergePredictor,
};

fn bytes(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn collect(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                collect(root, &path, out);
            } else {
                out.insert(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    collect(dir, dir, &mut out);
    out
}

#[test]
fn conflicting_and_clean_predictions_leave_every_repository_byte_unchanged() {
    let f = Fixture::init();
    let base = f.commit("shared.txt", "base\n", "Base");
    f.git(&["checkout", "-b", "source"]);
    f.commit("shared.txt", "source\n", "Source");
    f.git(&["checkout", "main"]);
    f.commit("shared.txt", "target\n", "Target");
    f.write("untracked.txt", "unsaved\n");
    let before = bytes(&f.path);
    let predictor = MergePredictor::default();
    let prediction = predictor
        .predict(&f.path, "main", "source", &CancelToken::new())
        .unwrap();
    assert_eq!(prediction.merge_base, base);
    assert_eq!(prediction.conflicted_files, ["shared.txt"]);
    assert_eq!(bytes(&f.path), before);
    let clean = predictor
        .predict(&f.path, "main", &base, &CancelToken::new())
        .unwrap();
    assert!(clean.conflicted_files.is_empty());
    assert_eq!(bytes(&f.path), before);
    let token = CancelToken::new();
    token.cancel();
    assert!(matches!(
        predictor.predict(&f.path, "main", "source", &token),
        Err(yforge_core::CoreError::Cancelled)
    ));
}

#[test]
fn comparison_and_ai_context_describe_only_the_source_range() {
    let f = Fixture::init();
    let base = f.commit("base.txt", "base\n", "Unrelated history");
    f.git(&["checkout", "-b", "source"]);
    let sha = f.commit("new.txt", "one\ntwo\n", "Add feature\n\nFeature detail");
    f.commit(".env", "SECRET_VALUE=never-send\n", "Add configuration");
    f.write("untracked.txt", "NEVER_SEND_WORKTREE\n");
    let comparison = branch_comparison(&f.path, "source", "main").unwrap();
    assert_eq!(comparison.merge_base, base);
    assert_eq!(comparison.commits.len(), 2);
    assert!(comparison
        .commits
        .iter()
        .any(|commit| commit.sha == sha && commit.author == "Yui Lin" && commit.timestamp > 0));
    assert_eq!(
        (comparison.files, comparison.additions, comparison.deletions),
        (2, 3, 0)
    );
    let context = pull_request_context(&f.path, "source", "main", &CancelToken::new()).unwrap();
    assert_eq!(context.commit_messages.len(), 2);
    assert!(context
        .commit_messages
        .iter()
        .any(|message| message.contains("Feature detail")));
    assert!(!context.diff.contains("never-send"));
    assert!(!context.diff.contains("NEVER_SEND_WORKTREE"));
    assert_eq!(context.excluded, [".env"]);
}

#[test]
fn templates_use_standard_worktree_locations_case_insensitively() {
    let f = Fixture::init();
    assert_eq!(pull_request_template(&f.path).unwrap(), None);
    f.write("docs/PuLl_ReQuEsT_TeMpLaTe.MD", "## Summary\n");
    assert_eq!(
        pull_request_template(&f.path).unwrap().as_deref(),
        Some("## Summary\n")
    );
    f.write(".github/PULL_REQUEST_TEMPLATE.md", "## Changes\n");
    assert_eq!(
        pull_request_template(&f.path).unwrap().as_deref(),
        Some("## Changes\n")
    );
    let gitlab = Fixture::init();
    gitlab.write(".gitlab/merge_request_templates/Default.md", "## Testing\n");
    assert_eq!(
        pull_request_template(&gitlab.path).unwrap().as_deref(),
        Some("## Testing\n")
    );
}

#[test]
fn prediction_does_not_execute_repository_merge_drivers() {
    let f = Fixture::init();
    f.commit(".gitattributes", "shared.txt merge=unsafe\n", "Attributes");
    f.commit("shared.txt", "base\n", "Base");
    f.git(&[
        "config",
        "merge.unsafe.driver",
        "touch unexpected-write; exit 0",
    ]);
    f.git(&["checkout", "-b", "source"]);
    f.commit("shared.txt", "source\n", "Source");
    f.git(&["checkout", "main"]);
    f.commit("shared.txt", "target\n", "Target");
    let before = bytes(&f.path);
    let result = MergePredictor::default()
        .predict(&f.path, "main", "source", &CancelToken::new())
        .unwrap_err();
    assert_eq!(result.kind(), yforge_core::ErrorKind::Unsupported);
    assert!(!f.path.join("unexpected-write").exists());
    assert_eq!(bytes(&f.path), before);
}

#[test]
fn comparisons_never_lazy_fetch_missing_partial_clone_content() {
    let f = Fixture::init();
    f.commit("file.txt", "base\n", "Base");
    f.commit("file.txt", "changed\n", "Change");
    f.git(&["config", "uploadpack.allowFilter", "true"]);
    let clone = f.sibling("partial");
    f.git(&[
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        &format!("file://{}", f.path.display()),
        clone.to_str().unwrap(),
    ]);
    let before = bytes(&clone);
    assert!(branch_comparison(&clone, "HEAD", "HEAD~").is_err());
    assert_eq!(bytes(&clone), before);
}
