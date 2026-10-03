mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::Fixture;
use yforge_core::{
    add_recent, folder_scan, launchpad_wips, load_recents, repositories_list, repository_remove,
    repository_restore, scan_folder_remove, scan_folder_rescan, scan_folder_save, start_storage,
    ErrorKind, FoundRepo, ManagedRepo, ScannedFolder,
};

fn data() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    dir
}

struct Disk {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

impl Disk {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap().join("code");
        fs::create_dir(&root).unwrap();
        Self { _dir: dir, root }
    }

    fn repo(&self, relative: &str, head: &str) -> String {
        let path = self.root.join(relative);
        fs::create_dir_all(path.join(".git")).unwrap();
        fs::write(path.join(".git/HEAD"), head).unwrap();
        text(&path)
    }

    fn dir(&self, relative: &str) -> PathBuf {
        let path = self.root.join(relative);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn root(&self) -> String {
        text(&self.root)
    }
}

fn text(path: &Path) -> String {
    path.display().to_string()
}

fn on(branch: &str) -> String {
    format!("ref: refs/heads/{branch}\n")
}

fn found_paths(found: &[FoundRepo]) -> Vec<String> {
    found.iter().map(|repo| repo.path.clone()).collect()
}

fn folder(path: &str, repos: &[&str], skipped: &[&str]) -> ScannedFolder {
    ScannedFolder {
        path: path.to_owned(),
        depth: 2,
        scanned_at: 1_000,
        repos: repos.iter().map(|repo| (*repo).to_owned()).collect(),
        skipped: skipped.iter().map(|repo| (*repo).to_owned()).collect(),
    }
}

fn opened(dir: &Path, path: &str, opened_at: i64) {
    repository_restore(
        dir,
        &ManagedRepo {
            path: path.to_owned(),
            folder: None,
            opened_at: Some(opened_at),
        },
    )
    .unwrap();
}

#[test]
fn the_depth_counts_levels_from_the_direct_children_of_the_root() {
    let dir = data();
    let disk = Disk::new();
    let a = disk.repo("a", &on("main"));
    let b = disk.repo("group/b", &on("feature/x"));
    let c = disk.repo("group/deeper/c", &on("main"));

    let one = folder_scan(dir.path(), &disk.root, 1).unwrap();
    let two = folder_scan(dir.path(), &disk.root, 2).unwrap();
    let three = folder_scan(dir.path(), &disk.root, 3).unwrap();

    assert_eq!(found_paths(&one.found), std::slice::from_ref(&a));
    assert_eq!(found_paths(&two.found), [a.clone(), b.clone()]);
    assert_eq!(found_paths(&three.found), [a.clone(), b.clone(), c]);
    assert_eq!(
        (three.root.as_str(), three.depth),
        (disk.root().as_str(), 3)
    );
    assert!(!three.capped);
    assert!(three.checked >= 5, "{three:?}");
    assert_eq!(
        two.found,
        [
            FoundRepo {
                path: a,
                branch: Some("main".to_owned()),
                listed: false,
            },
            FoundRepo {
                path: b,
                branch: Some("feature/x".to_owned()),
                listed: false,
            },
        ]
    );
}

#[test]
fn hidden_folders_node_modules_symlinks_and_repository_insides_are_not_searched() {
    let dir = data();
    let disk = Disk::new();
    disk.repo(".hidden/secret", &on("main"));
    disk.repo("node_modules/package", &on("main"));
    let outer = disk.repo("outer", &on("main"));
    disk.repo("outer/inner", &on("main"));
    let detached = disk.repo("detached", "4b825dc642cb6eb9a060e54bf8d69288fbee4904\n");
    let worktree = disk.dir("worktree");
    fs::write(
        worktree.join(".git"),
        "gitdir: /elsewhere/.git/worktrees/w\n",
    )
    .unwrap();
    let outside = Disk::new();
    outside.repo("linked", &on("main"));
    std::os::unix::fs::symlink(&outside.root, disk.root.join("link")).unwrap();

    let scan = folder_scan(dir.path(), &disk.root, 5).unwrap();

    assert_eq!(
        scan.found,
        [
            FoundRepo {
                path: detached,
                branch: None,
                listed: false,
            },
            FoundRepo {
                path: outer,
                branch: Some("main".to_owned()),
                listed: false,
            },
            FoundRepo {
                path: text(&worktree),
                branch: None,
                listed: false,
            },
        ]
    );
}

#[test]
fn a_root_that_is_a_repository_is_the_only_repository_found() {
    let dir = data();
    let disk = Disk::new();
    disk.repo("", &on("trunk"));
    disk.repo("nested", &on("main"));

    let scan = folder_scan(dir.path(), &disk.root, 3).unwrap();

    assert_eq!(
        scan.found,
        [FoundRepo {
            path: disk.root(),
            branch: Some("trunk".to_owned()),
            listed: false,
        }]
    );
}

#[test]
fn a_root_with_trailing_slashes_is_normalised() {
    let dir = data();
    let disk = Disk::new();
    let a = disk.repo("a", &on("main"));

    let scan = folder_scan(dir.path(), Path::new(&format!("{}//", disk.root())), 1).unwrap();

    assert_eq!(scan.root, disk.root());
    assert_eq!(found_paths(&scan.found), [a]);
}

#[test]
fn a_missing_root_or_a_file_is_refused_with_the_path() {
    let dir = data();
    let disk = Disk::new();
    let file = disk.root.join("notes.txt");
    fs::write(&file, "x").unwrap();
    let missing = disk.root.join("gone");

    for root in [&missing, &file] {
        let error = folder_scan(dir.path(), root, 2).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::NotFound);
        assert_eq!(
            error.to_string(),
            format!("There is no folder at {}.", text(root))
        );
    }
}

#[test]
fn a_depth_outside_one_to_five_is_refused() {
    let dir = data();
    let disk = Disk::new();

    for depth in [0, 6] {
        let error = folder_scan(dir.path(), &disk.root, depth).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
        assert_eq!(error.to_string(), "Choose 1 to 5 levels.");
    }
}

#[test]
fn scanning_an_already_scanned_folder_is_refused() {
    let dir = data();
    let disk = Disk::new();
    scan_folder_save(dir.path(), &folder(&disk.root(), &[], &[])).unwrap();

    let error = folder_scan(dir.path(), Path::new(&format!("{}/", disk.root())), 2).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(
        error.to_string(),
        format!(
            "{} is already a scanned folder. Rescan it instead.",
            disk.root()
        )
    );
}

#[test]
fn found_repositories_already_in_the_list_are_marked_listed() {
    let dir = data();
    let disk = Disk::new();
    let a = disk.repo("a", &on("main"));
    let b = disk.repo("b", &on("main"));
    add_recent(dir.path(), &a).unwrap();

    let scan = folder_scan(dir.path(), &disk.root, 1).unwrap();

    let listed: Vec<(String, bool)> = scan
        .found
        .iter()
        .map(|repo| (repo.path.clone(), repo.listed))
        .collect();
    assert_eq!(listed, [(a, true), (b, false)]);
}

#[test]
fn the_list_merges_scanned_folders_with_recents_opened_first_then_by_path() {
    let dir = data();
    opened(dir.path(), "/r/opened-later", 200);
    opened(dir.path(), "/r/b", 100);
    let first = folder("/r", &["/r/c", "/r/b", "/r/a"], &["/r/skipped"]);
    let second = folder("/other", &["/other/z"], &[]);

    scan_folder_save(dir.path(), &first).unwrap();
    let repositories = scan_folder_save(dir.path(), &second).unwrap();

    assert_eq!(repositories, repositories_list(dir.path()).unwrap());
    assert_eq!(repositories.folders, [first, second]);
    let managed = |path: &str, folder: Option<&str>, opened_at: Option<i64>| ManagedRepo {
        path: path.to_owned(),
        folder: folder.map(str::to_owned),
        opened_at,
    };
    assert_eq!(
        repositories.repos,
        [
            managed("/r/opened-later", None, Some(200)),
            managed("/r/b", Some("/r"), Some(100)),
            managed("/other/z", Some("/other"), None),
            managed("/r/a", Some("/r"), None),
            managed("/r/c", Some("/r"), None),
        ]
    );
}

#[test]
fn saving_a_folder_again_replaces_its_repositories_and_skipped_paths() {
    let dir = data();
    scan_folder_save(dir.path(), &folder("/r", &["/r/a"], &["/r/b"])).unwrap();
    let replaced = folder("/r", &["/r/b"], &["/r/a"]);

    let repositories = scan_folder_save(dir.path(), &replaced).unwrap();

    assert_eq!(repositories.folders, [replaced]);
}

#[test]
fn a_rescan_appends_only_new_paths_that_were_not_skipped() {
    let dir = data();
    let disk = Disk::new();
    let a = disk.repo("a", &on("main"));
    let b = disk.repo("b", &on("main"));
    scan_folder_save(
        dir.path(),
        &folder(&disk.root(), &[a.as_str()], &[b.as_str()]),
    )
    .unwrap();
    let d = disk.repo("group/d", &on("main"));
    disk.repo("group/deeper/too-deep", &on("main"));

    let rescan = scan_folder_rescan(dir.path(), &disk.root).unwrap();

    assert_eq!(rescan.added, std::slice::from_ref(&d));
    let saved = &rescan.repositories.folders[0];
    assert_eq!(saved.repos, [a, d]);
    assert_eq!(saved.skipped, [b]);
    assert!(saved.scanned_at > 1_000);
    assert_eq!(rescan.repositories, repositories_list(dir.path()).unwrap());
}

#[test]
fn a_rescan_of_an_unknown_or_vanished_folder_is_refused_and_changes_nothing() {
    let dir = data();
    let disk = Disk::new();
    let unknown = scan_folder_rescan(dir.path(), &disk.root).unwrap_err();
    assert_eq!(unknown.kind(), ErrorKind::NotFound);
    assert_eq!(
        unknown.to_string(),
        format!("{} is not a scanned folder.", disk.root())
    );

    let saved = folder(&disk.root(), &["/kept"], &[]);
    scan_folder_save(dir.path(), &saved).unwrap();
    fs::remove_dir(&disk.root).unwrap();

    let vanished = scan_folder_rescan(dir.path(), &disk.root).unwrap_err();

    assert_eq!(
        vanished.to_string(),
        format!("There is no folder at {}.", disk.root())
    );
    assert_eq!(repositories_list(dir.path()).unwrap().folders, [saved]);
}

#[test]
fn removing_a_folder_keeps_its_opened_repositories_and_can_be_undone() {
    let dir = data();
    opened(dir.path(), "/r/a", 100);
    let saved = folder("/r", &["/r/a", "/r/b"], &["/r/c"]);
    scan_folder_save(dir.path(), &saved).unwrap();

    let removed = scan_folder_remove(dir.path(), Path::new("/r/")).unwrap();

    assert_eq!(removed.folder, saved);
    assert!(removed.repositories.folders.is_empty());
    assert_eq!(
        removed.repositories.repos,
        [ManagedRepo {
            path: "/r/a".to_owned(),
            folder: None,
            opened_at: Some(100),
        }]
    );
    assert_eq!(removed.repositories, repositories_list(dir.path()).unwrap());
    let undone = scan_folder_save(dir.path(), &removed.folder).unwrap();
    assert_eq!(undone.folders, [saved]);
    assert_eq!(undone.repos.len(), 2);
    let missing = scan_folder_remove(dir.path(), Path::new("/nowhere")).unwrap_err();
    assert_eq!(missing.to_string(), "/nowhere is not a scanned folder.");
}

#[test]
fn removing_a_repository_skips_it_on_rescan_and_restoring_puts_it_back() {
    let dir = data();
    let disk = Disk::new();
    let a = disk.repo("a", &on("main"));
    let b = disk.repo("b", &on("main"));
    opened(dir.path(), &a, 100);
    scan_folder_save(
        dir.path(),
        &folder(&disk.root(), &[a.as_str(), b.as_str()], &[]),
    )
    .unwrap();

    let removed = repository_remove(dir.path(), &a).unwrap();

    let row = ManagedRepo {
        path: a.clone(),
        folder: Some(disk.root()),
        opened_at: Some(100),
    };
    assert_eq!(removed.removed, row);
    let after = &removed.repositories;
    assert_eq!(
        after
            .repos
            .iter()
            .map(|repo| &repo.path)
            .collect::<Vec<_>>(),
        [&b]
    );
    assert_eq!(after.folders[0].repos, std::slice::from_ref(&b));
    assert_eq!(after.folders[0].skipped, std::slice::from_ref(&a));
    assert!(load_recents(dir.path()).unwrap().is_empty());
    assert!(scan_folder_rescan(dir.path(), &disk.root)
        .unwrap()
        .added
        .is_empty());

    let restored = repository_restore(dir.path(), &removed.removed).unwrap();

    assert_eq!(restored.repos[0], row);
    assert_eq!(restored.folders[0].repos, [a.clone(), b]);
    assert!(restored.folders[0].skipped.is_empty());
    let recents = load_recents(dir.path()).unwrap();
    assert_eq!(
        recents
            .iter()
            .map(|recent| (recent.path.as_str(), recent.opened_at))
            .collect::<Vec<_>>(),
        [(a.as_str(), 100)]
    );
    let unlisted = repository_remove(dir.path(), "/not/listed").unwrap_err();
    assert_eq!(unlisted.to_string(), "/not/listed is not in the list.");
}

#[test]
fn restoring_into_a_folder_that_was_removed_only_restores_the_recent() {
    let dir = data();
    scan_folder_save(dir.path(), &folder("/r", &["/r/a"], &[])).unwrap();
    opened(dir.path(), "/r/a", 100);
    let removed = repository_remove(dir.path(), "/r/a").unwrap();
    scan_folder_remove(dir.path(), Path::new("/r")).unwrap();

    let restored = repository_restore(dir.path(), &removed.removed).unwrap();

    assert!(restored.folders.is_empty());
    assert_eq!(
        restored.repos,
        [ManagedRepo {
            path: "/r/a".to_owned(),
            folder: None,
            opened_at: Some(100),
        }]
    );
}

#[test]
fn start_storage_creates_the_scanned_folder_tables_in_a_database_that_predates_them() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    add_recent(dir.path(), "/r/kept").unwrap();
    let connection = rusqlite::Connection::open(dir.path().join("yforge.db")).unwrap();
    connection
        .execute_batch(
            "DROP TABLE profile_sessions; DROP TABLE profiles; DROP TABLE hook_approvals;
             DROP TABLE scanned_repos; DROP TABLE scanned_folders; PRAGMA user_version = 11;",
        )
        .unwrap();
    drop(connection);

    start_storage(dir.path()).unwrap();

    let repositories = scan_folder_save(dir.path(), &folder("/r", &["/r/a"], &[])).unwrap();
    assert_eq!(
        repositories
            .repos
            .iter()
            .map(|repo| repo.path.as_str())
            .collect::<Vec<_>>(),
        ["/r/kept", "/r/a"]
    );
}

#[test]
fn wips_include_a_scanned_repository_that_was_never_opened() {
    let dir = data();
    let dirty = Fixture::init();
    dirty.commit("a.txt", "a", "first");
    dirty.write("a.txt", "changed");
    let parent = dirty.path.parent().unwrap();
    let scan = folder_scan(dir.path(), parent, 1).unwrap();
    assert_eq!(found_paths(&scan.found), [text(&dirty.path)]);
    scan_folder_save(
        dir.path(),
        &folder(&text(parent), &[text(&dirty.path).as_str()], &[]),
    )
    .unwrap();

    let wips = launchpad_wips(dir.path()).unwrap();

    assert_eq!(
        wips.iter()
            .map(|wip| (wip.path.clone(), wip.changes))
            .collect::<Vec<_>>(),
        [(text(&dirty.path), 1)]
    );
}
