use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use yforge_core::{install_cli, ErrorKind};

fn fake_app(dir: &Path, name: &str) -> PathBuf {
    let app = dir.join(name);
    fs::write(
        &app,
        "#!/bin/sh\n{ pwd; for argument in \"$@\"; do printf '%s\\n' \"$argument\"; done; } > \"$YFORGE_TEST_LOG\"\n",
    )
    .unwrap();
    fs::set_permissions(&app, fs::Permissions::from_mode(0o755)).unwrap();
    app
}

fn scratch() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    (dir, root)
}

#[test]
fn installs_an_executable_script_that_starts_the_app_detached_with_the_callers_arguments_and_directory(
) {
    let (_guard, root) = scratch();
    let app = fake_app(&root, "YForge App");
    let bin = root.join("home/.local/bin");
    let log = root.join("log");
    let work = root.join("work");
    fs::create_dir(&work).unwrap();

    let installed = install_cli(&bin, &app).unwrap();

    let target = bin.join("yforge");
    assert_eq!(installed.path, target.display().to_string());
    assert!(!installed.replaced);
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o755
    );
    let status = Command::new("/bin/sh")
        .arg(&target)
        .args(["relative dir", "/abs"])
        .current_dir(&work)
        .env("YFORGE_TEST_LOG", &log)
        .status()
        .unwrap();
    assert!(status.success());
    let started = Instant::now();
    while fs::read_to_string(&log).map_or(true, |text| text.lines().count() < 3) {
        assert!(started.elapsed() < Duration::from_secs(5), "app never ran");
        std::thread::sleep(Duration::from_millis(20));
    }
    let lines: Vec<String> = fs::read_to_string(&log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    assert_eq!(
        lines,
        [
            work.display().to_string(),
            "relative dir".into(),
            "/abs".into()
        ]
    );
}

#[test]
fn quotes_an_app_path_that_contains_a_single_quote() {
    let (_guard, root) = scratch();
    let app = fake_app(&root, "it's YForge");
    let bin = root.join("bin");
    let log = root.join("log");

    install_cli(&bin, &app).unwrap();
    Command::new("/bin/sh")
        .arg(bin.join("yforge"))
        .arg("x")
        .env("YFORGE_TEST_LOG", &log)
        .status()
        .unwrap();

    let started = Instant::now();
    while fs::read_to_string(&log).map_or(true, |text| text.lines().count() < 2) {
        assert!(started.elapsed() < Duration::from_secs(5), "app never ran");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(fs::read_to_string(&log).unwrap().lines().last(), Some("x"));
}

#[test]
fn reinstalling_replaces_its_own_script_and_points_it_at_the_new_app() {
    let (_guard, root) = scratch();
    let old = fake_app(&root, "old");
    let new = fake_app(&root, "new");
    let bin = root.join("bin");
    install_cli(&bin, &old).unwrap();

    let again = install_cli(&bin, &new).unwrap();

    assert!(again.replaced);
    let script = fs::read_to_string(bin.join("yforge")).unwrap();
    assert!(script.contains(new.to_str().unwrap()));
    assert!(!script.contains(old.to_str().unwrap()));
}

#[test]
fn never_overwrites_a_file_or_link_it_did_not_create() {
    let (_guard, root) = scratch();
    let app = fake_app(&root, "app");
    let bin = root.join("bin");
    fs::create_dir(&bin).unwrap();
    let target = bin.join("yforge");

    fs::write(&target, "#!/bin/sh\necho mine\n").unwrap();
    let foreign = install_cli(&bin, &app).unwrap_err();
    assert_eq!(foreign.kind(), ErrorKind::InvalidRequest);
    assert_eq!(
        fs::read_to_string(&target).unwrap(),
        "#!/bin/sh\necho mine\n"
    );

    fs::remove_file(&target).unwrap();
    std::os::unix::fs::symlink(&app, &target).unwrap();
    let link = install_cli(&bin, &app).unwrap_err();
    assert_eq!(link.kind(), ErrorKind::InvalidRequest);
    assert!(fs::symlink_metadata(&target)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn reports_permission_problems_truthfully_and_leaves_nothing_behind() {
    let (_guard, root) = scratch();
    let app = fake_app(&root, "app");
    let locked = root.join("locked");
    fs::create_dir(&locked).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();

    let error = install_cli(&locked, &app).unwrap_err();
    let nested = install_cli(&locked.join("deeper/bin"), &app).unwrap_err();

    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert!(error.to_string().contains("Permission denied"), "{error}");
    assert_eq!(nested.kind(), ErrorKind::StorageFailed);
    assert!(nested.to_string().contains("Permission denied"), "{nested}");
    assert_eq!(fs::read_dir(&locked).unwrap().count(), 0);
}

#[test]
fn needs_an_absolute_existing_app_file() {
    let (_guard, root) = scratch();
    let bin = root.join("bin");

    for app in [Path::new("yforge"), &root.join("missing"), &root] {
        assert_eq!(
            install_cli(&bin, app).unwrap_err().kind(),
            ErrorKind::InvalidRequest,
            "{app:?}"
        );
    }
    assert!(!bin.exists());
}
