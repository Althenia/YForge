use yforge_core::{list_crashes, CrashOrigin};

#[test]
fn a_panicking_thread_records_a_redacted_crash_row_and_still_unwinds() {
    let data = tempfile::tempdir().unwrap();
    yforge_core::start_storage(data.path()).unwrap();
    yforge_lib::note_repository("/srv/secret-repo");
    yforge_lib::install_panic_hook(data.path().to_path_buf());

    let outcome = std::thread::Builder::new()
        .name("crash-test-worker".to_owned())
        .spawn(|| {
            panic!("failed in /srv/secret-repo using https://yui:tok3n@example.test/x.git");
        })
        .unwrap()
        .join();

    assert!(outcome.is_err());
    let crashes = list_crashes(data.path(), None, 10).unwrap();
    assert_eq!(crashes.len(), 1);
    let crash = &crashes[0];
    assert_eq!(crash.origin, CrashOrigin::Rust);
    assert_eq!(crash.kind, "panic");
    assert_eq!(crash.thread.as_deref(), Some("crash-test-worker"));
    assert_eq!(
        crash.message,
        "failed in <repository> using https://***@example.test/x.git"
    );
    assert_eq!(crash.app_version, env!("CARGO_PKG_VERSION"));
    assert!(crash
        .location
        .as_deref()
        .is_some_and(|at| at.contains("panic_hook.rs")));
    assert!(crash
        .stack
        .as_deref()
        .is_some_and(|stack| !stack.is_empty()));
}
