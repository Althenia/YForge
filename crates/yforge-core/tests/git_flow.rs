mod common;

use common::Fixture;
use yforge_core::{
    flow_finish, flow_snapshot, flow_start, git_flow_config, git_flow_init, head_ref,
    plan_branch_create, plan_flow_finish, undo, FlowKind, GitFlowConfig, OperationOutcome, Planned,
};

fn defaults() -> GitFlowConfig {
    GitFlowConfig {
        production: "main".to_owned(),
        development: "develop".to_owned(),
        feature: "feature/".to_owned(),
        release: "release/".to_owned(),
        hotfix: "hotfix/".to_owned(),
        version_tag: "v".to_owned(),
    }
}

fn initialized() -> Fixture {
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    git_flow_init(&fixture.path, &defaults()).unwrap();
    fixture
}

fn parents(fixture: &Fixture, revision: &str) -> usize {
    fixture
        .git(&["rev-list", "--parents", "-n", "1", revision])
        .split_whitespace()
        .count()
        - 1
}

fn branches(fixture: &Fixture) -> Vec<String> {
    fixture
        .git(&["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn initializing_stores_the_configuration_the_way_git_flow_does_and_creates_develop() {
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    assert_eq!(git_flow_config(&fixture.path).unwrap(), None);

    git_flow_init(&fixture.path, &defaults()).unwrap();

    for (key, value) in [
        ("gitflow.branch.master", "main"),
        ("gitflow.branch.develop", "develop"),
        ("gitflow.prefix.feature", "feature/"),
        ("gitflow.prefix.release", "release/"),
        ("gitflow.prefix.hotfix", "hotfix/"),
        ("gitflow.prefix.versiontag", "v"),
        ("gitflow.prefix.bugfix", "bugfix/"),
        ("gitflow.prefix.support", "support/"),
    ] {
        assert_eq!(
            fixture.git(&["config", "--local", "--get", key]),
            value,
            "{key}"
        );
    }
    assert_eq!(git_flow_config(&fixture.path).unwrap(), Some(defaults()));
    assert_eq!(
        fixture.git(&["rev-parse", "develop"]),
        fixture.git(&["rev-parse", "main"])
    );
    assert_eq!(fixture.git(&["branch", "--show-current"]), "main");
}

#[test]
fn initializing_again_keeps_an_existing_development_branch_and_takes_new_values() {
    let fixture = initialized();
    fixture.git(&["switch", "-q", "develop"]);
    let tip = fixture.commit("dev.txt", "dev\n", "dev work");
    fixture.git(&["switch", "-q", "main"]);
    let changed = GitFlowConfig {
        feature: "feat/".to_owned(),
        version_tag: String::new(),
        ..defaults()
    };

    git_flow_init(&fixture.path, &changed).unwrap();

    assert_eq!(fixture.git(&["rev-parse", "develop"]), tip);
    assert_eq!(git_flow_config(&fixture.path).unwrap(), Some(changed));
}

#[test]
fn refuses_a_configuration_git_flow_cannot_use_and_changes_nothing() {
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    let broken = [
        GitFlowConfig {
            development: "main".to_owned(),
            ..defaults()
        },
        GitFlowConfig {
            production: "trunk".to_owned(),
            ..defaults()
        },
        GitFlowConfig {
            feature: String::new(),
            ..defaults()
        },
        GitFlowConfig {
            release: "feature/".to_owned(),
            ..defaults()
        },
        GitFlowConfig {
            hotfix: "bad prefix ".to_owned(),
            ..defaults()
        },
        GitFlowConfig {
            version_tag: "v ~".to_owned(),
            ..defaults()
        },
        GitFlowConfig {
            development: "bad..name".to_owned(),
            ..defaults()
        },
    ];

    for config in broken {
        assert!(git_flow_init(&fixture.path, &config).is_err(), "{config:?}");
    }

    assert_eq!(git_flow_config(&fixture.path).unwrap(), None);
    assert_eq!(branches(&fixture), vec!["main"]);
}

#[test]
fn start_creates_the_branch_from_development_or_production_and_checks_it_out() {
    let fixture = initialized();
    fixture.git(&["switch", "-q", "develop"]);
    let development = fixture.commit("dev.txt", "dev\n", "dev work");
    let production = fixture.git(&["rev-parse", "main"]);

    assert_eq!(
        flow_start(&fixture.path, FlowKind::Feature, "login").unwrap(),
        "feature/login"
    );
    assert_eq!(fixture.git(&["branch", "--show-current"]), "feature/login");
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), development);

    fixture.git(&["switch", "-q", "develop"]);
    assert_eq!(
        flow_start(&fixture.path, FlowKind::Release, "1.0").unwrap(),
        "release/1.0"
    );
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), development);

    assert_eq!(
        flow_start(&fixture.path, FlowKind::Hotfix, "1.0.1").unwrap(),
        "hotfix/1.0.1"
    );
    assert_eq!(fixture.git(&["branch", "--show-current"]), "hotfix/1.0.1");
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), production);
}

#[test]
fn start_refuses_an_empty_name_a_taken_name_and_an_uninitialized_repository() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Feature, "login").unwrap();

    assert!(flow_start(&fixture.path, FlowKind::Feature, "  ").is_err());
    assert!(flow_start(&fixture.path, FlowKind::Feature, "login").is_err());
    assert!(flow_start(&fixture.path, FlowKind::Feature, "bad name").is_err());
    assert_eq!(fixture.git(&["branch", "--show-current"]), "feature/login");

    let plain = Fixture::init();
    plain.identity();
    plain.commit("a.txt", "a\n", "init");
    assert!(flow_start(&plain.path, FlowKind::Feature, "x")
        .unwrap_err()
        .to_string()
        .contains("initialize Git Flow"));
}

#[test]
fn start_is_recorded_with_an_undo_that_deletes_the_branch_and_switches_back() {
    let fixture = initialized();
    fixture.git(&["switch", "-q", "develop"]);
    let before = head_ref(&fixture.path).unwrap();

    let name = flow_start(&fixture.path, FlowKind::Feature, "login").unwrap();
    let tip = fixture.git(&["rev-parse", &name]);
    let Planned::Available(plan) = plan_branch_create(&name, &tip, &before, true) else {
        panic!("start must be undoable");
    };
    undo(&fixture.path, &plan.action).unwrap();

    assert_eq!(fixture.git(&["branch", "--show-current"]), "develop");
    assert!(!branches(&fixture).contains(&name));
}

#[test]
fn finishing_a_feature_merges_into_development_with_a_merge_commit_and_deletes_it() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Feature, "login").unwrap();
    fixture.commit("login.txt", "login\n", "login work");
    let feature_tip = fixture.git(&["rev-parse", "HEAD"]);
    let production = fixture.git(&["rev-parse", "main"]);

    let finished = flow_finish(&fixture.path).unwrap();

    assert_eq!(finished.outcome, OperationOutcome::Completed);
    assert_eq!(finished.branch, "feature/login");
    assert_eq!(finished.tag, None);
    assert_eq!(fixture.git(&["branch", "--show-current"]), "develop");
    assert_eq!(parents(&fixture, "develop"), 2);
    assert!(fixture
        .git(&["merge-base", "--is-ancestor", &feature_tip, "develop"])
        .is_empty());
    assert_eq!(fixture.read("login.txt"), "login\n");
    assert_eq!(branches(&fixture), vec!["develop", "main"]);
    assert_eq!(fixture.git(&["rev-parse", "main"]), production);
    assert!(fixture.git(&["tag"]).is_empty());
}

#[test]
fn finishing_a_release_merges_into_production_tags_it_merges_back_and_deletes_it() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Release, "1.0").unwrap();
    fixture.commit("notes.txt", "notes\n", "release prep");
    let release_tip = fixture.git(&["rev-parse", "HEAD"]);

    let finished = flow_finish(&fixture.path).unwrap();

    assert_eq!(finished.outcome, OperationOutcome::Completed);
    assert_eq!(finished.tag.as_deref(), Some("v1.0"));
    assert_eq!(parents(&fixture, "main"), 2);
    assert_eq!(
        fixture.git(&["rev-parse", "v1.0^{commit}"]),
        fixture.git(&["rev-parse", "main"])
    );
    assert_eq!(fixture.git(&["cat-file", "-t", "v1.0"]), "tag");
    assert_eq!(parents(&fixture, "develop"), 2);
    for target in ["main", "develop"] {
        assert!(fixture
            .git(&["merge-base", "--is-ancestor", &release_tip, target])
            .is_empty());
    }
    assert_eq!(fixture.git(&["branch", "--show-current"]), "develop");
    assert_eq!(branches(&fixture), vec!["develop", "main"]);
}

#[test]
fn finishing_a_hotfix_uses_the_hotfix_name_and_the_empty_version_prefix() {
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    git_flow_init(
        &fixture.path,
        &GitFlowConfig {
            version_tag: String::new(),
            ..defaults()
        },
    )
    .unwrap();
    flow_start(&fixture.path, FlowKind::Hotfix, "1.0.1").unwrap();
    fixture.commit("fix.txt", "fix\n", "fix");

    let finished = flow_finish(&fixture.path).unwrap();

    assert_eq!(finished.tag.as_deref(), Some("1.0.1"));
    assert_eq!(fixture.git(&["tag"]), "1.0.1");
    assert_eq!(fixture.read("fix.txt"), "fix\n");
    fixture.git(&["switch", "-q", "main"]);
    assert_eq!(fixture.read("fix.txt"), "fix\n");
}

#[test]
fn a_conflicting_finish_stops_in_the_merge_state_and_deletes_nothing() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Feature, "login").unwrap();
    fixture.commit("README.md", "feature\n", "feature edit");
    fixture.git(&["switch", "-q", "develop"]);
    fixture.commit("README.md", "develop\n", "develop edit");
    fixture.git(&["switch", "-q", "feature/login"]);
    let feature_tip = fixture.git(&["rev-parse", "HEAD"]);

    let finished = flow_finish(&fixture.path).unwrap();

    assert_eq!(finished.outcome, OperationOutcome::Conflicts);
    assert!(fixture.path.join(".git/MERGE_HEAD").exists());
    assert_eq!(fixture.git(&["branch", "--show-current"]), "develop");
    assert_eq!(fixture.git(&["rev-parse", "feature/login"]), feature_tip);
    assert!(branches(&fixture).contains(&"feature/login".to_owned()));
}

#[test]
fn a_release_that_conflicts_on_production_is_neither_tagged_nor_deleted() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Release, "1.0").unwrap();
    fixture.commit("README.md", "release\n", "release edit");
    fixture.git(&["switch", "-q", "main"]);
    fixture.commit("README.md", "production\n", "production edit");
    fixture.git(&["switch", "-q", "release/1.0"]);

    let finished = flow_finish(&fixture.path).unwrap();

    assert_eq!(finished.outcome, OperationOutcome::Conflicts);
    assert_eq!(finished.tag, None);
    assert!(fixture.git(&["tag"]).is_empty());
    assert!(fixture.path.join(".git/MERGE_HEAD").exists());
    assert!(branches(&fixture).contains(&"release/1.0".to_owned()));
}

#[test]
fn a_release_that_conflicts_when_merged_back_keeps_its_tag_and_its_branch() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Release, "1.0").unwrap();
    fixture.commit("README.md", "release\n", "release edit");
    fixture.git(&["switch", "-q", "develop"]);
    fixture.commit("README.md", "develop\n", "develop edit");
    fixture.git(&["switch", "-q", "release/1.0"]);

    let finished = flow_finish(&fixture.path).unwrap();

    assert_eq!(finished.outcome, OperationOutcome::Conflicts);
    assert_eq!(finished.tag.as_deref(), Some("v1.0"));
    assert_eq!(fixture.git(&["tag"]), "v1.0");
    assert!(fixture.path.join(".git/MERGE_HEAD").exists());
    assert!(branches(&fixture).contains(&"release/1.0".to_owned()));
}

#[test]
fn finish_refuses_before_changing_anything() {
    let fixture = initialized();
    assert!(flow_finish(&fixture.path)
        .unwrap_err()
        .to_string()
        .contains("not a feature"));

    flow_start(&fixture.path, FlowKind::Release, "1.0").unwrap();
    fixture.commit("notes.txt", "notes\n", "prep");
    fixture.git(&["tag", "v1.0"]);
    let heads = fixture.git(&["for-each-ref", "refs/heads"]);
    assert!(flow_finish(&fixture.path)
        .unwrap_err()
        .to_string()
        .contains("already exists"));
    assert_eq!(fixture.git(&["for-each-ref", "refs/heads"]), heads);

    fixture.git(&["tag", "--delete", "v1.0"]);
    fixture.write("README.md", "dirty\n");
    assert!(flow_finish(&fixture.path).is_err());
    assert_eq!(fixture.git(&["for-each-ref", "refs/heads"]), heads);
    assert_eq!(fixture.git(&["branch", "--show-current"]), "release/1.0");
}

#[test]
fn undoing_a_finish_restores_every_branch_the_tag_and_the_checkout() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Release, "1.0").unwrap();
    fixture.commit("notes.txt", "notes\n", "prep");
    let heads = fixture.git(&["for-each-ref", "refs/heads"]);
    let before = flow_snapshot(&fixture.path).unwrap();
    let finished = flow_finish(&fixture.path).unwrap();
    let Planned::Available(plan) = plan_flow_finish(&fixture.path, &before, &finished).unwrap()
    else {
        panic!("a completed finish must be undoable");
    };
    assert!(plan.scope.contains("release/1.0"));
    assert!(plan.scope.contains("v1.0"));

    undo(&fixture.path, &plan.action).unwrap();

    assert_eq!(fixture.git(&["for-each-ref", "refs/heads"]), heads);
    assert_eq!(fixture.git(&["branch", "--show-current"]), "release/1.0");
    assert!(fixture.git(&["tag"]).is_empty());
    assert!(fixture.git(&["status", "--porcelain"]).is_empty());
    assert_eq!(fixture.read("notes.txt"), "notes\n");
}

#[test]
fn undoing_a_finish_is_refused_once_a_branch_has_new_work() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Feature, "login").unwrap();
    fixture.commit("login.txt", "login\n", "login work");
    let before = flow_snapshot(&fixture.path).unwrap();
    let finished = flow_finish(&fixture.path).unwrap();
    let Planned::Available(plan) = plan_flow_finish(&fixture.path, &before, &finished).unwrap()
    else {
        panic!("a completed finish must be undoable");
    };
    fixture.commit("later.txt", "later\n", "later work");
    let heads = fixture.git(&["for-each-ref", "refs/heads"]);

    let refused = undo(&fixture.path, &plan.action).unwrap_err();

    assert!(refused.to_string().contains("Nothing was changed"));
    assert_eq!(fixture.git(&["for-each-ref", "refs/heads"]), heads);
}

#[test]
fn a_conflicting_finish_has_no_undo() {
    let fixture = initialized();
    flow_start(&fixture.path, FlowKind::Feature, "login").unwrap();
    fixture.commit("README.md", "feature\n", "feature edit");
    fixture.git(&["switch", "-q", "develop"]);
    fixture.commit("README.md", "develop\n", "develop edit");
    fixture.git(&["switch", "-q", "feature/login"]);
    let before = flow_snapshot(&fixture.path).unwrap();
    let finished = flow_finish(&fixture.path).unwrap();

    assert!(matches!(
        plan_flow_finish(&fixture.path, &before, &finished).unwrap(),
        Planned::Unavailable(_)
    ));
}
