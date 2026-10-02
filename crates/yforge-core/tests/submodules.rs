mod common;

use common::Fixture;
use yforge_core::{add_submodule, deinit_submodule, list_submodules, load_repo_settings, save_repo_settings, stage_submodule, update_submodule, RepoSettings, SubmoduleStatus};

#[test]
fn lists_a_current_submodule_then_a_dirty_pointer_and_an_uninitialized_checkout() {
    let parent = Fixture::init();
    parent.identity();
    parent.git(&["config", "protocol.file.allow", "always"]);
    parent.commit("README.md", "parent\n", "init");
    let child = Fixture::init();
    child.identity();
    let first = child.commit("lib.txt", "core\n", "core");

    let url = child.path.to_str().expect("utf-8");
    assert!(add_submodule(&parent.path, "  ", "vendor/icons", None).is_err());
    parent.git(&["submodule", "add", "-b", "main", "--", url, "vendor/icons"]);

    let listed = list_submodules(&parent.path).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].path, "vendor/icons");
    assert_eq!(listed[0].branch.as_deref(), Some("main"));
    assert_eq!(listed[0].status, SubmoduleStatus::Current);
    assert_eq!(listed[0].recorded, first);
    assert_eq!(listed[0].checked_out.as_deref(), Some(first.as_str()));

    let checkout = parent.path.join("vendor/icons");
    parent.run_in(&checkout, &["commit", "-q", "--allow-empty", "-m", "more"]);
    let dirty = list_submodules(&parent.path).unwrap();
    assert_eq!(dirty[0].status, SubmoduleStatus::Dirty);
    assert_eq!(dirty[0].recorded, first);
    assert_ne!(dirty[0].checked_out.as_deref(), Some(first.as_str()));

    stage_submodule(&parent.path, "vendor/icons").unwrap();
    let staged = parent.git(&["diff", "--cached", "--raw"]);
    assert!(staged.contains("160000"), "{staged}");
    assert!(staged.contains("vendor/icons"), "{staged}");
    assert!(!parent.git(&["diff", "--cached", "--name-only", "--", "vendor/icons/lib.txt"]).contains("lib.txt"));

    deinit_submodule(&parent.path, "vendor/icons").unwrap();
    let removed = list_submodules(&parent.path).unwrap();
    assert_eq!(removed[0].status, SubmoduleStatus::Uninitialized);
    assert_eq!(removed[0].checked_out, None);
    assert!(!checkout.join(".git").exists());
    assert!(!checkout.join("lib.txt").exists());

    update_submodule(&parent.path, "vendor/icons").unwrap();
    assert_eq!(list_submodules(&parent.path).unwrap()[0].status, SubmoduleStatus::Current);
}

#[test]
fn keeps_update_on_fetch_off_until_it_is_saved() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(load_repo_settings(dir.path(), "/repo").unwrap().submodule_update_on_fetch, None);
    save_repo_settings(dir.path(), "/repo", &RepoSettings { submodule_update_on_fetch: Some(true), ..RepoSettings::default() }).unwrap();
    assert_eq!(load_repo_settings(dir.path(), "/repo").unwrap().submodule_update_on_fetch, Some(true));
    save_repo_settings(dir.path(), "/repo", &RepoSettings::default()).unwrap();
    assert_eq!(load_repo_settings(dir.path(), "/repo").unwrap().submodule_update_on_fetch, None);
}
