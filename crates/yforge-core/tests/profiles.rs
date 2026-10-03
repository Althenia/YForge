mod common;

use std::sync::{Mutex, MutexGuard};

use common::Fixture;
use rusqlite::Connection;
use yforge_core::{
    commit, create_tag, load_session, merge, profile_activate, profile_delete, profile_save,
    profile_switch, profiles_list, save_session, ErrorKind, MergeMode, ProfileDraft, TabSession,
    DEFAULT_PROFILE,
};

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn draft(name: &str, author: &str, email: &str) -> ProfileDraft {
    ProfileDraft {
        name: name.to_owned(),
        author_name: author.to_owned(),
        author_email: email.to_owned(),
    }
}

fn session(tabs: &[&str]) -> TabSession {
    TabSession {
        tabs: tabs.iter().map(|tab| (*tab).to_owned()).collect(),
        active: 0,
        groups: Vec::new(),
    }
}

#[test]
fn default_always_exists_with_an_empty_author_and_is_active() {
    let _one = serial();
    let dir = tempfile::tempdir().unwrap();

    let list = profiles_list(dir.path()).unwrap();

    assert_eq!(list.active, DEFAULT_PROFILE);
    assert_eq!(list.profiles.len(), 1);
    assert_eq!(list.profiles[0].name, "Default");
    assert_eq!(
        (
            list.profiles[0].author_name.as_str(),
            list.profiles[0].author_email.as_str()
        ),
        ("", "")
    );
}

#[test]
fn profiles_are_added_renamed_and_validated() {
    let _one = serial();
    let dir = tempfile::tempdir().unwrap();

    let work = profile_save(
        dir.path(),
        None,
        &draft(" Work ", " Ana Ruiz ", "ana@work.test"),
    )
    .unwrap();
    assert_eq!(work.name, "Work");
    assert_eq!(work.author_name, "Ana Ruiz");

    let renamed = profile_save(
        dir.path(),
        Some(&work.id),
        &draft("Client", "Ana Ruiz", "ana@work.test"),
    )
    .unwrap();
    assert_eq!(renamed.id, work.id);
    let names: Vec<String> = profiles_list(dir.path())
        .unwrap()
        .profiles
        .into_iter()
        .map(|profile| profile.name)
        .collect();
    assert_eq!(names, ["Default", "Client"]);

    let refused = [
        draft("", "Ana", "ana@work.test"),
        draft("Other", "", "ana@work.test"),
        draft("Other", "Ana", "not-an-email"),
        draft("Other", "Ana <x>", "ana@work.test"),
        draft("client", "Ana", "ana@work.test"),
        draft(&"x".repeat(41), "Ana", "ana@work.test"),
    ];
    for bad in refused {
        assert_eq!(
            profile_save(dir.path(), None, &bad).unwrap_err().kind(),
            ErrorKind::InvalidRequest,
            "{bad:?}"
        );
    }
    assert_eq!(profiles_list(dir.path()).unwrap().profiles.len(), 2);

    let default = profile_save(
        dir.path(),
        Some(DEFAULT_PROFILE),
        &draft("Personal", "", ""),
    )
    .unwrap();
    assert_eq!(
        (default.name.as_str(), default.author_name.as_str()),
        ("Personal", "")
    );
    assert_eq!(
        profile_save(
            dir.path(),
            Some("missing"),
            &draft("Z", "Ana", "ana@work.test")
        )
        .unwrap_err()
        .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn the_active_profile_and_default_cannot_be_deleted_but_others_can() {
    let _one = serial();
    let dir = tempfile::tempdir().unwrap();
    let work = profile_save(dir.path(), None, &draft("Work", "Ana", "ana@work.test")).unwrap();
    let side = profile_save(dir.path(), None, &draft("Side", "Ana", "ana@side.test")).unwrap();
    profile_switch(dir.path(), &work.id).unwrap();

    for refused in [
        profile_delete(dir.path(), &work.id),
        profile_delete(dir.path(), DEFAULT_PROFILE),
        profile_delete(dir.path(), "missing"),
    ] {
        assert_eq!(refused.unwrap_err().kind(), ErrorKind::InvalidRequest);
    }

    profile_delete(dir.path(), &side.id).unwrap();
    let remaining: Vec<String> = profiles_list(dir.path())
        .unwrap()
        .profiles
        .into_iter()
        .map(|profile| profile.id)
        .collect();
    assert_eq!(remaining, [DEFAULT_PROFILE.to_owned(), work.id]);
}

#[test]
fn each_profile_keeps_its_own_tabs_and_session_calls_follow_the_active_profile() {
    let _one = serial();
    let dir = tempfile::tempdir().unwrap();
    let work = profile_save(dir.path(), None, &draft("Work", "Ana", "ana@work.test")).unwrap();
    save_session(dir.path(), &session(&["/repos/personal", "/repos/blog"])).unwrap();

    profile_switch(dir.path(), &work.id).unwrap();
    assert_eq!(load_session(dir.path()).unwrap(), TabSession::default());
    assert_eq!(profiles_list(dir.path()).unwrap().active, work.id);
    save_session(dir.path(), &session(&["/repos/api"])).unwrap();

    profile_switch(dir.path(), DEFAULT_PROFILE).unwrap();
    assert_eq!(
        load_session(dir.path()).unwrap(),
        session(&["/repos/personal", "/repos/blog"])
    );

    profile_switch(dir.path(), &work.id).unwrap();
    assert_eq!(load_session(dir.path()).unwrap(), session(&["/repos/api"]));
    assert_eq!(
        profile_switch(dir.path(), "missing").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(profiles_list(dir.path()).unwrap().active, work.id);
}

#[test]
fn commits_merge_commits_and_tags_use_the_active_profiles_author_without_touching_git_config() {
    let _one = serial();
    let dir = tempfile::tempdir().unwrap();
    let work = profile_save(
        dir.path(),
        None,
        &draft("Work", "Ana Ruiz", "ana@work.test"),
    )
    .unwrap();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.commit("b.txt", "topic\n", "Topic");
    repo.git(&["checkout", "-q", "main"]);
    let who = |revision: &str| repo.git(&["log", "-1", "--format=%an <%ae> | %cn <%ce>", revision]);
    let me = "Yui Lin <yui@example.test> | Yui Lin <yui@example.test>";
    let ana = "Ana Ruiz <ana@work.test> | Ana Ruiz <ana@work.test>";

    profile_switch(dir.path(), &work.id).unwrap();
    repo.write("c.txt", "main\n");
    repo.git(&["add", "c.txt"]);
    let sha = commit(&repo.path, "As Ana", "", false).unwrap();
    assert_eq!(who(&sha), ana);
    merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();
    assert_eq!(who("HEAD"), ana);
    create_tag(&repo.path, "v1", None, Some("Release")).unwrap();
    assert!(repo
        .git(&["cat-file", "tag", "v1"])
        .contains("tagger Ana Ruiz <ana@work.test>"));
    assert_eq!(repo.git(&["config", "user.name"]), "Yui Lin");
    assert_eq!(repo.git(&["config", "user.email"]), "yui@example.test");

    profile_switch(dir.path(), DEFAULT_PROFILE).unwrap();
    repo.write("d.txt", "again\n");
    repo.git(&["add", "d.txt"]);
    let sha = commit(&repo.path, "As me", "", false).unwrap();
    assert_eq!(who(&sha), me);
}

#[test]
fn activating_at_startup_applies_the_stored_active_profile() {
    let _one = serial();
    let stored = tempfile::tempdir().unwrap();
    let work = profile_save(
        stored.path(),
        None,
        &draft("Work", "Ana Ruiz", "ana@work.test"),
    )
    .unwrap();
    profile_switch(stored.path(), &work.id).unwrap();
    let fresh = tempfile::tempdir().unwrap();
    profile_switch(fresh.path(), DEFAULT_PROFILE).unwrap();
    let repo = Fixture::init();
    repo.identity();
    repo.write("a.txt", "one\n");
    repo.git(&["add", "a.txt"]);
    let first = commit(&repo.path, "First", "", false).unwrap();
    assert_eq!(repo.git(&["log", "-1", "--format=%an", &first]), "Yui Lin");

    profile_activate(stored.path()).unwrap();

    repo.write("b.txt", "two\n");
    repo.git(&["add", "b.txt"]);
    let second = commit(&repo.path, "Second", "", false).unwrap();
    assert_eq!(
        repo.git(&["log", "-1", "--format=%an", &second]),
        "Ana Ruiz"
    );
    profile_activate(fresh.path()).unwrap();
}

#[test]
fn a_database_from_before_profiles_keeps_its_tabs_as_the_default_profiles_tabs() {
    let _one = serial();
    let dir = tempfile::tempdir().unwrap();
    save_session(dir.path(), &session(&["/repos/personal", "/repos/blog"])).unwrap();
    let database = Connection::open(dir.path().join("yforge.db")).unwrap();
    database
        .execute_batch(
            "DROP TABLE profile_sessions; DROP TABLE profiles; PRAGMA user_version = 14;",
        )
        .unwrap();
    drop(database);

    let list = profiles_list(dir.path()).unwrap();

    assert_eq!(list.active, DEFAULT_PROFILE);
    assert_eq!(list.profiles.len(), 1);
    assert_eq!(
        load_session(dir.path()).unwrap(),
        session(&["/repos/personal", "/repos/blog"])
    );
}
