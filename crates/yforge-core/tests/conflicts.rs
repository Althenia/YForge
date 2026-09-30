mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;

use common::Fixture;
use yforge_core::{
    conflict_file, conflict_reset, conflict_resolve, conflict_take_side, operation_continue,
    repo_snapshot, ConflictSegment, ConflictSide, ErrorKind, OperationOutcome,
};

fn lines(items: &[&str]) -> Vec<String> {
    items.iter().map(|line| (*line).to_owned()).collect()
}

fn merge_conflict(base: &str, topic: &str, main: &str) -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", base, "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.txt", topic, "Topic edit");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", main, "Main edit");
    repo.git_expecting_conflict(&["merge", "topic"]);
    repo
}

fn regions(file: &yforge_core::ConflictFile) -> usize {
    file.segments
        .iter()
        .filter(|segment| matches!(segment, ConflictSegment::Conflict { .. }))
        .count()
}

#[test]
fn a_two_way_conflict_is_parsed_into_current_and_incoming_with_all_stages_present() {
    let repo = merge_conflict("base\n", "topic\n", "main\n");

    let file = conflict_file(&repo.path, "a.txt").unwrap();

    assert_eq!(
        file.segments,
        vec![ConflictSegment::Conflict {
            current: lines(&["main"]),
            incoming: lines(&["topic"]),
            base: None
        }]
    );
    assert!(file.sides.base && file.sides.current && file.sides.incoming);
    assert!(!file.binary);
    assert_eq!(file.eol, "\n");
    assert!(file.final_newline);
}

#[test]
fn diff3_and_zdiff3_styles_expose_the_base_lines() {
    for style in ["diff3", "zdiff3"] {
        let repo = Fixture::init();
        repo.identity();
        repo.git(&["config", "merge.conflictStyle", style]);
        repo.commit("a.txt", "base\n", "Base");
        repo.git(&["switch", "-q", "-c", "topic"]);
        repo.commit("a.txt", "topic\n", "Topic edit");
        repo.git(&["switch", "-q", "main"]);
        repo.commit("a.txt", "main\n", "Main edit");
        repo.git_expecting_conflict(&["merge", "topic"]);

        let file = conflict_file(&repo.path, "a.txt").unwrap();

        assert_eq!(
            file.segments,
            vec![ConflictSegment::Conflict {
                current: lines(&["main"]),
                incoming: lines(&["topic"]),
                base: Some(lines(&["base"]))
            }],
            "{style}"
        );
    }
}

#[test]
fn several_regions_keep_the_text_between_them() {
    let repo = Fixture::init();
    repo.identity();
    repo.numbered("a.txt", &[]);
    repo.git(&["add", "a.txt"]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.numbered("a.txt", &[(3, "topic 3"), (25, "topic 25")]);
    repo.git(&["commit", "-q", "-am", "Topic"]);
    repo.git(&["switch", "-q", "main"]);
    repo.numbered("a.txt", &[(3, "main 3"), (25, "main 25")]);
    repo.git(&["commit", "-q", "-am", "Main"]);
    repo.git_expecting_conflict(&["merge", "topic"]);

    let file = conflict_file(&repo.path, "a.txt").unwrap();

    assert_eq!(regions(&file), 2);
    assert_eq!(file.segments.len(), 5);
    assert!(matches!(&file.segments[2], ConflictSegment::Text { lines } if lines.len() == 21));
}

#[test]
fn crlf_files_report_their_line_ending() {
    let repo = merge_conflict(
        "a\r\nbase\r\nz\r\n",
        "a\r\ntopic\r\nz\r\n",
        "a\r\nmain\r\nz\r\n",
    );

    let file = conflict_file(&repo.path, "a.txt").unwrap();

    assert_eq!(file.eol, "\r\n");
    assert_eq!(regions(&file), 1);
    assert_eq!(
        file.segments[0],
        ConflictSegment::Text {
            lines: lines(&["a"])
        }
    );
}

#[test]
fn resolving_writes_the_result_atomically_stages_it_and_lets_the_merge_complete() {
    let repo = merge_conflict("base\n", "topic\n", "main\n");
    let target = repo.path.join("a.txt");
    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();

    conflict_resolve(&repo.path, "a.txt", "main\ntopic\n").unwrap();

    assert_eq!(repo.read("a.txt"), "main\ntopic\n");
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o755
    );
    let leftovers: Vec<_> = fs::read_dir(&repo.path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("yforge"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.counts.conflicted, 0);
    assert_eq!(snapshot.operation_detail.unwrap().resolved, vec!["a.txt"]);
    assert_eq!(
        operation_continue(&repo.path, None).unwrap(),
        OperationOutcome::Completed
    );
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "main\ntopic");
}

#[test]
fn resolving_with_leftover_markers_writes_nothing() {
    let repo = merge_conflict("base\n", "topic\n", "main\n");
    let before = repo.read("a.txt");

    let error = conflict_resolve(
        &repo.path,
        "a.txt",
        "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> topic\n",
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::ConflictMarkers);
    assert_eq!(repo.read("a.txt"), before);
    assert_eq!(repo_snapshot(&repo.path).unwrap().counts.conflicted, 1);
}

#[test]
fn only_conflicted_files_can_be_read_resolved_or_reset() {
    let repo = merge_conflict("base\n", "topic\n", "main\n");
    repo.write("other.txt", "keep\n");

    assert_eq!(
        conflict_file(&repo.path, "other.txt").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        conflict_resolve(&repo.path, "other.txt", "overwritten\n")
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        conflict_reset(&repo.path, "../a.txt").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(repo.read("other.txt"), "keep\n");
}

#[test]
fn taking_a_side_uses_current_as_the_merge_head_and_incoming_as_the_merged_branch() {
    let repo = merge_conflict("base\n", "topic\n", "main\n");

    conflict_take_side(&repo.path, "a.txt", ConflictSide::Incoming).unwrap();

    assert_eq!(repo.read("a.txt"), "topic\n");
    assert_eq!(repo_snapshot(&repo.path).unwrap().counts.conflicted, 0);
}

#[test]
fn during_a_rebase_current_is_the_rebase_target_and_incoming_is_the_replayed_commit() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.txt", "topic\n", "Topic edit");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main edit");
    repo.git(&["switch", "-q", "topic"]);
    repo.git_expecting_conflict(&["rebase", "main"]);

    let file = conflict_file(&repo.path, "a.txt").unwrap();
    conflict_take_side(&repo.path, "a.txt", ConflictSide::Current).unwrap();

    assert_eq!(
        file.segments,
        vec![ConflictSegment::Conflict {
            current: lines(&["main"]),
            incoming: lines(&["topic"]),
            base: None
        }]
    );
    assert_eq!(repo.read("a.txt"), "main\n");
}

#[test]
fn taking_the_side_that_deleted_the_file_removes_it() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.git(&["rm", "-q", "a.txt"]);
    repo.git(&["commit", "-q", "-m", "Delete"]);
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "changed\n", "Edit");
    repo.git_expecting_conflict(&["merge", "topic"]);

    let file = conflict_file(&repo.path, "a.txt").unwrap();
    assert!(file.sides.current && !file.sides.incoming);
    assert_eq!(regions(&file), 0);
    conflict_take_side(&repo.path, "a.txt", ConflictSide::Incoming).unwrap();

    assert!(!repo.path.join("a.txt").exists());
    assert_eq!(repo_snapshot(&repo.path).unwrap().counts.conflicted, 0);
}

#[test]
fn binary_conflicts_are_flagged_and_resolved_by_taking_a_side() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.bin", "base\0\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.bin", "topic\0\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.bin", "main\0\n", "Main");
    repo.git_expecting_conflict(&["merge", "topic"]);

    let file = conflict_file(&repo.path, "a.bin").unwrap();
    conflict_take_side(&repo.path, "a.bin", ConflictSide::Incoming).unwrap();

    assert!(file.binary);
    assert!(file.segments.is_empty());
    assert_eq!(repo.read("a.bin"), "topic\0\n");
}

#[test]
fn resetting_a_file_restores_its_conflict_markers() {
    let repo = merge_conflict("base\n", "topic\n", "main\n");
    let original = conflict_file(&repo.path, "a.txt").unwrap();
    repo.write("a.txt", "half done\n");
    assert_eq!(regions(&conflict_file(&repo.path, "a.txt").unwrap()), 0);

    conflict_reset(&repo.path, "a.txt").unwrap();

    assert_eq!(conflict_file(&repo.path, "a.txt").unwrap(), original);
    assert_eq!(repo_snapshot(&repo.path).unwrap().counts.conflicted, 1);
}
