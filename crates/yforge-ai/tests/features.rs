mod common;

use common::{chat_reply, use_provider, Harness, Reply, Repo};
use yforge_ai::AiError;
use yforge_core::{
    commit_changes_context, commit_context, compose_apply, conflict_file, recompose_apply,
    recompose_preview, working_changes_context, AiFeature, CancelToken, ConflictSegment, CoreError,
    ErrorKind,
};

fn kind_of(error: AiError) -> ErrorKind {
    CoreError::from(error).kind()
}

#[tokio::test]
async fn a_commit_message_draft_uses_the_staged_diff_and_changes_nothing_in_the_repository() {
    let h = Harness::new();
    let repo = Repo::new();
    repo.commit("a.txt", "one\n", "Start the project");
    repo.write("a.txt", "one\ntwo\n");
    repo.write(".env", "TOKEN=hunter2\n");
    repo.git(&["add", "a.txt", ".env"]);
    let before = repo.snapshot();
    let long = format!("Add a very long summary {}", "that keeps going ".repeat(8));
    let reply = serde_json::json!({"summary": long, "description": "Body text."}).to_string();
    let ai = h.ai();
    let (fake, selection) = use_provider(&h, &ai, Reply::ok(&chat_reply(&reply))).await;
    let context = commit_context(&repo.path).unwrap();

    let draft = ai
        .commit_message(&selection, &context, &CancelToken::new())
        .await
        .unwrap();

    assert!(draft.summary.chars().count() <= 72);
    assert!(draft.summary_trimmed);
    assert_eq!(draft.description, "Body text.");
    assert_eq!(draft.excluded, [".env"]);
    assert_eq!(repo.snapshot(), before);
    let sent = &fake.requests()[0].body;
    assert!(sent.contains("+two"));
    assert!(sent.contains("- Start the project") || sent.contains("Start the project"));
    assert!(!sent.contains("hunter2"));
}

fn two_commit_repo() -> Repo {
    let repo = Repo::new();
    repo.commit(
        "a.txt",
        "a1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\n",
        "Base",
    );
    repo.write(
        "a.txt",
        "A1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\n",
    );
    repo.write("b.txt", "b\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Add b and touch the top of a"]);
    repo.write(
        "a.txt",
        "A1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\nA12\n",
    );
    repo.git(&["commit", "-q", "-am", "Touch the bottom of a"]);
    repo
}

fn reply_for(preview: &yforge_core::RecomposePreview, split_a: bool) -> String {
    let a = preview
        .files
        .iter()
        .find(|file| file.path == "a.txt")
        .unwrap();
    let hunk = |id: &str| serde_json::json!({"kind": "hunk", "id": id});
    let file = |path: &str| serde_json::json!({"kind": "file", "path": path});
    let groups = if split_a && a.hunks.len() == 2 {
        serde_json::json!([
            {"message": "Add b and the top of a", "changes": [file("b.txt"), hunk(&a.hunks[0].id)]},
            {"message": "Add the bottom of a", "changes": [hunk(&a.hunks[1].id)]}
        ])
    } else {
        serde_json::json!([{"message": "Everything", "changes": [file("a.txt"), file("b.txt")]}])
    };
    serde_json::json!({"groups": groups}).to_string()
}

#[tokio::test]
async fn a_recompose_proposal_is_ready_for_recompose_apply_and_the_call_itself_rewrites_nothing() {
    let h = Harness::new();
    let repo = two_commit_repo();
    let base = repo.git(&["rev-parse", "HEAD~2"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let ai = h.ai();
    let (_fake, selection) =
        use_provider(&h, &ai, Reply::ok(&chat_reply(&reply_for(&preview, true)))).await;
    let before = repo.snapshot();

    let proposal = ai
        .recompose(&selection, &preview, &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(
        repo.snapshot(),
        before,
        "proposing does not touch the repository"
    );
    assert_eq!(proposal.groups.len(), 2);
    assert!(proposal.excluded.is_empty());
    let original_tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    recompose_apply(&repo.path, &base, &proposal.groups).unwrap();
    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), original_tree);
    assert_eq!(
        repo.git(&["rev-list", "--count", &format!("{base}..HEAD")]),
        "2"
    );
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s"]),
        "Add the bottom of a"
    );
}

#[tokio::test]
async fn a_proposal_that_omits_a_change_is_rejected_and_nothing_is_repaired() {
    let h = Harness::new();
    let repo = two_commit_repo();
    let base = repo.git(&["rev-parse", "HEAD~2"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let reply = serde_json::json!({"groups": [{"message": "Only b", "changes": [{"kind": "file", "path": "b.txt"}]}]}).to_string();
    let ai = h.ai();
    let (_fake, selection) = use_provider(&h, &ai, Reply::ok(&chat_reply(&reply))).await;
    let before = repo.snapshot();

    let error = ai
        .recompose(&selection, &preview, &CancelToken::new())
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiInvalidResponse { reason, .. } => {
            assert!(reason.contains("not in any group"), "{reason}")
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(repo.snapshot(), before);
}

#[tokio::test]
async fn secret_file_hunks_are_withheld_from_the_recompose_prompt_and_reported() {
    let h = Harness::new();
    let repo = Repo::new();
    repo.commit("base.txt", "base\n", "Base");
    repo.write(".env", "TOKEN=hunter2\n");
    repo.write("ok.txt", "fine\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Add files"]);
    let base = repo.git(&["rev-parse", "HEAD~1"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let ai = h.ai();
    let reply = serde_json::json!({"groups": [{"message": "All", "changes": [{"kind": "file", "path": ".env"}, {"kind": "file", "path": "ok.txt"}]}]}).to_string();
    let (fake, selection) = use_provider(&h, &ai, Reply::ok(&chat_reply(&reply))).await;

    let proposal = ai
        .recompose(&selection, &preview, &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(proposal.excluded, [".env"]);
    let sent = &fake.requests()[0].body;
    assert!(!sent.contains("hunter2"));
    assert!(sent.contains("+fine"));
}

fn conflict_repo() -> Repo {
    let repo = Repo::new();
    repo.commit(
        "a.txt",
        "head\nshared\nmiddle\nm2\nm3\nm4\nm5\nm6\nm7\ntail\n",
        "Base",
    );
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit(
        "a.txt",
        "head\nTOPIC\nmiddle\nm2\nm3\nm4\nm5\nm6\nm7\ntail TOPIC\n",
        "Topic",
    );
    repo.git(&["switch", "-q", "main"]);
    repo.commit(
        "a.txt",
        "head\nMAIN\nmiddle\nm2\nm3\nm4\nm5\nm6\nm7\ntail MAIN\n",
        "Main",
    );
    let merge = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo.path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .output()
        .unwrap();
    assert!(!merge.status.success());
    repo
}

#[tokio::test]
async fn a_conflict_proposal_answers_every_region_and_writes_nothing() {
    let h = Harness::new();
    let repo = conflict_repo();
    let file = conflict_file(&repo.path, "a.txt").unwrap();
    let regions = file
        .segments
        .iter()
        .filter(|s| matches!(s, ConflictSegment::Conflict { .. }))
        .count();
    assert_eq!(regions, 2);
    let reply = serde_json::json!({"regions": [
        {"index": 0, "text": "MAIN and TOPIC", "rationale": "Keep both."},
        {"index": 1, "text": "tail MAIN TOPIC\n", "rationale": "Merge the tails."}
    ]})
    .to_string();
    let ai = h.ai();
    let (fake, selection) = use_provider(&h, &ai, Reply::ok(&chat_reply(&reply))).await;
    let on_disk = repo.read("a.txt");
    let before = repo.snapshot();

    let proposal = ai
        .conflict(&selection, &file, &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(proposal.regions.len(), 2);
    assert_eq!(
        (proposal.regions[0].index, proposal.regions[0].text.as_str()),
        (0, "MAIN and TOPIC")
    );
    assert_eq!(proposal.regions[1].text, "tail MAIN TOPIC");
    assert_eq!(proposal.regions[1].rationale, "Merge the tails.");
    assert_eq!(repo.read("a.txt"), on_disk);
    assert_eq!(repo.snapshot(), before);
    let sent = &fake.requests()[0].body;
    assert!(
        sent.contains("CURRENT")
            && sent.contains("INCOMING")
            && sent.contains("MAIN")
            && sent.contains("TOPIC")
    );
}

#[tokio::test]
async fn a_conflict_reply_that_misses_a_region_or_keeps_markers_is_rejected() {
    let h = Harness::new();
    let repo = conflict_repo();
    let file = conflict_file(&repo.path, "a.txt").unwrap();
    let ai = h.ai();
    for reply in [
        r#"{"regions":[{"index":0,"text":"x","rationale":"r"}]}"#,
        r#"{"regions":[{"index":0,"text":"<<<<<<< HEAD","rationale":"r"},{"index":1,"text":"y","rationale":"r"}]}"#,
    ] {
        let (_fake, selection) = use_provider(&h, &ai, Reply::ok(&chat_reply(reply))).await;
        let error = ai
            .conflict(&selection, &file, &CancelToken::new())
            .await
            .unwrap_err();
        assert_eq!(kind_of(error), ErrorKind::AiInvalidResponse);
    }
}

#[tokio::test]
async fn a_secret_file_conflict_never_reaches_the_provider() {
    let h = Harness::new();
    let repo = Repo::new();
    repo.commit(".env", "A=1\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit(".env", "A=2\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.commit(".env", "A=3\n", "Main");
    let _ = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo.path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .output()
        .unwrap();
    let file = conflict_file(&repo.path, ".env").unwrap();
    let ai = h.ai();
    let (fake, selection) = use_provider(&h, &ai, Reply::ok(&chat_reply("{}"))).await;

    let error = ai
        .conflict(&selection, &file, &CancelToken::new())
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::InvalidRequest);
    assert!(fake.requests().is_empty());
}

async fn feature_provider(
    h: &Harness,
    ai: &yforge_ai::Ai,
    feature: AiFeature,
    reply: &str,
) -> (common::HttpFake, yforge_ai::Selection) {
    let (fake, _) = use_provider(h, ai, Reply::ok(&chat_reply(reply))).await;
    let selection = ai.resolve(h.dir(), feature).await.unwrap();
    (fake, selection)
}

fn working_repo() -> Repo {
    let repo = Repo::new();
    repo.commit("a.txt", "one\n", "Start");
    repo.write("a.txt", "one\ntwo\n");
    repo.write("b.txt", "new file\n");
    repo.write(".env", "TOKEN=hunter2\n");
    repo
}

#[tokio::test]
async fn explaining_changes_sends_the_working_diff_with_its_prompt_and_changes_nothing() {
    let h = Harness::new();
    let repo = working_repo();
    let reply = serde_json::json!({"files": [
        {"path": "b.txt", "text": "Adds b."},
        {"path": "a.txt", "text": "Adds a second line."}
    ]})
    .to_string();
    let ai = h.ai();
    let (fake, selection) = feature_provider(&h, &ai, AiFeature::ExplainChanges, &reply).await;
    let context = working_changes_context(&repo.path).unwrap();
    let before = repo.snapshot();

    let explanation = ai
        .explain(&selection, &context, &CancelToken::new())
        .await
        .unwrap();

    let paths: Vec<&str> = explanation.items.iter().map(|i| i.path.as_str()).collect();
    assert_eq!(paths, ["a.txt", "b.txt"]);
    assert_eq!(explanation.excluded, [".env"]);
    assert_eq!(repo.snapshot(), before);
    let sent = &fake.requests()[0].body;
    assert!(sent.contains("explain uncommitted Git changes"));
    assert!(sent.contains("+two") && sent.contains("+new file"));
    assert!(!sent.contains("hunter2"));
}

#[tokio::test]
async fn explaining_a_commit_sends_its_message_and_diff() {
    let h = Harness::new();
    let repo = Repo::new();
    repo.commit("a.txt", "one\n", "Start");
    repo.commit("a.txt", "one\nexplained\n", "Explain this");
    let sha = repo.git(&["rev-parse", "HEAD"]);
    let reply =
        serde_json::json!({"files": [{"path": "a.txt", "text": "Adds a line."}]}).to_string();
    let ai = h.ai();
    let (fake, selection) = feature_provider(&h, &ai, AiFeature::ExplainCommit, &reply).await;
    let context = commit_changes_context(&repo.path, &sha).unwrap();

    let explanation = ai
        .explain(&selection, &context, &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(explanation.items[0].text, "Adds a line.");
    let sent = &fake.requests()[0].body;
    assert!(sent.contains("explain a Git commit"));
    assert!(sent.contains("Explain this") && sent.contains("+explained"));
}

#[tokio::test]
async fn a_compose_proposal_is_ready_for_compose_apply_and_proposing_changes_nothing() {
    let h = Harness::new();
    let repo = working_repo();
    let reply = serde_json::json!({"groups": [
        {"message": "Extend a", "files": ["a.txt"]},
        {"message": "Add b and env", "files": ["b.txt", ".env"]}
    ]})
    .to_string();
    let ai = h.ai();
    let (fake, selection) = feature_provider(&h, &ai, AiFeature::ComposeCommits, &reply).await;
    let context = working_changes_context(&repo.path).unwrap();
    let before = repo.snapshot();

    let proposal = ai
        .compose(&selection, &context, &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(repo.snapshot(), before);
    assert_eq!(proposal.excluded, [".env"]);
    assert!(fake.requests()[0]
        .body
        .contains("split uncommitted Git changes"));
    compose_apply(&repo.path, &proposal.groups[..1]).unwrap();
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Extend a");
    assert_eq!(repo.git(&["status", "--porcelain"]), "?? .env\n?? b.txt");
}

#[tokio::test]
async fn a_compose_reply_that_leaves_a_file_out_is_rejected() {
    let h = Harness::new();
    let repo = working_repo();
    let reply =
        serde_json::json!({"groups": [{"message": "Only a", "files": ["a.txt"]}]}).to_string();
    let ai = h.ai();
    let (_fake, selection) = feature_provider(&h, &ai, AiFeature::ComposeCommits, &reply).await;
    let context = working_changes_context(&repo.path).unwrap();

    let error = ai
        .compose(&selection, &context, &CancelToken::new())
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AiInvalidResponse);
}

#[tokio::test]
async fn a_stash_message_draft_uses_the_working_changes() {
    let h = Harness::new();
    let repo = working_repo();
    let reply = serde_json::json!({"summary": "WIP: second line", "description": ""}).to_string();
    let ai = h.ai();
    let (fake, selection) = feature_provider(&h, &ai, AiFeature::StashMessage, &reply).await;
    let context = working_changes_context(&repo.path).unwrap();

    let draft = ai
        .stash_message(&selection, &context, &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(draft.summary, "WIP: second line");
    assert_eq!(draft.excluded, [".env"]);
    assert!(fake.requests()[0].body.contains("Git stash messages"));
}

#[tokio::test]
async fn a_cancelled_request_never_reaches_the_provider() {
    let h = Harness::new();
    let repo = working_repo();
    let ai = h.ai();
    let (fake, selection) = feature_provider(&h, &ai, AiFeature::ExplainChanges, "{}").await;
    let context = working_changes_context(&repo.path).unwrap();
    let cancel = CancelToken::new();
    cancel.cancel();

    let error = ai.explain(&selection, &context, &cancel).await.unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::Cancelled);
    assert!(fake.requests().is_empty());
}
