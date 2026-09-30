use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::CoreError;
use crate::git;
use crate::repo;

const QUIET_PERIOD: Duration = Duration::from_millis(150);
const MAX_WAIT: Duration = Duration::from_secs(1);

pub struct RepoWatcher {
    _watcher: RecommendedWatcher,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Change {
    Relevant,
    WorkingTree(PathBuf),
    Ignored,
}

fn classify(path: &Path, root: &Path, git_dirs: &[PathBuf]) -> Change {
    if let Some(inside) = git_dirs.iter().find_map(|dir| path.strip_prefix(dir).ok()) {
        let is_lock = path.extension() == Some(OsStr::new("lock"));
        let first = inside.components().next().map(|part| part.as_os_str());
        let tracked_state = matches!(inside.to_str(), Some("HEAD" | "index" | "packed-refs"))
            || first == Some(OsStr::new("refs"));
        return if tracked_state && !is_lock {
            Change::Relevant
        } else {
            Change::Ignored
        };
    }
    match path.strip_prefix(root) {
        Ok(inside)
            if inside.components().next().map(|part| part.as_os_str())
                != Some(OsStr::new(".git")) =>
        {
            Change::WorkingTree(inside.to_path_buf())
        }
        _ => Change::Ignored,
    }
}

fn some_path_is_not_ignored(root: &Path, paths: &[PathBuf]) -> bool {
    let input: String = paths
        .iter()
        .filter_map(|path| path.to_str())
        .flat_map(|path| [path, "\0"])
        .collect();
    let Ok(checked) = git::run_unchecked(root, &["check-ignore", "-z", "--stdin"], Some(&input))
    else {
        return true;
    };
    match checked.status {
        Some(0) => {
            let ignored: Vec<&str> = checked.stdout.split('\0').collect();
            paths
                .iter()
                .filter_map(|path| path.to_str())
                .any(|path| !ignored.contains(&path))
        }
        _ => true,
    }
}

fn is_relevant(root: &Path, git_dirs: &[PathBuf], batch: &[notify::Result<Event>]) -> bool {
    let mut working_tree = Vec::new();
    for result in batch {
        let Ok(event) = result else {
            return true;
        };
        if matches!(event.kind, EventKind::Access(_)) {
            continue;
        }
        for path in &event.paths {
            match classify(path, root, git_dirs) {
                Change::Relevant => return true,
                Change::WorkingTree(inside) => working_tree.push(inside),
                Change::Ignored => {}
            }
        }
    }
    !working_tree.is_empty() && some_path_is_not_ignored(root, &working_tree)
}

fn collect_batch(events: &Receiver<notify::Result<Event>>) -> Option<Vec<notify::Result<Event>>> {
    let mut batch = vec![events.recv().ok()?];
    let deadline = Instant::now() + MAX_WAIT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Some(batch);
        }
        match events.recv_timeout(QUIET_PERIOD.min(remaining)) {
            Ok(event) => batch.push(event),
            Err(RecvTimeoutError::Timeout) => return Some(batch),
            Err(RecvTimeoutError::Disconnected) => return Some(batch),
        }
    }
}

fn git_directories(root: &Path) -> Result<Vec<PathBuf>, CoreError> {
    let output = git::run(
        root,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-dir",
            "--git-common-dir",
        ],
    )?;
    let mut dirs: Vec<PathBuf> = output.lines().map(PathBuf::from).collect();
    dirs.dedup();
    Ok(dirs)
}

fn watch_failure(error: notify::Error) -> CoreError {
    CoreError::WatchFailed {
        detail: error.to_string(),
    }
}

pub fn watch_repo(
    path: &Path,
    on_change: impl Fn() + Send + 'static,
) -> Result<RepoWatcher, CoreError> {
    let root = repo::open(path)?;
    let git_dirs = git_directories(&root)?;
    let (sender, events) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = sender.send(event);
    })
    .map_err(watch_failure)?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(watch_failure)?;
    for dir in git_dirs.iter().filter(|dir| !dir.starts_with(&root)) {
        watcher
            .watch(dir, RecursiveMode::Recursive)
            .map_err(watch_failure)?;
    }
    std::thread::spawn(move || {
        while let Some(batch) = collect_batch(&events) {
            if is_relevant(&root, &git_dirs, &batch) {
                on_change();
            }
        }
    });
    Ok(RepoWatcher { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> Vec<PathBuf> {
        vec![PathBuf::from("/r/.git")]
    }

    fn classify_in(path: &str) -> Change {
        classify(Path::new(path), Path::new("/r"), &dirs())
    }

    #[test]
    fn keeps_head_index_and_refs_inside_the_git_directory() {
        for path in [
            "/r/.git/HEAD",
            "/r/.git/index",
            "/r/.git/packed-refs",
            "/r/.git/refs/heads/main",
            "/r/.git/refs/tags/v1",
        ] {
            assert_eq!(classify_in(path), Change::Relevant, "{path}");
        }
    }

    #[test]
    fn drops_other_git_internals_and_lock_files() {
        for path in [
            "/r/.git/objects/ab/cdef",
            "/r/.git/index.lock",
            "/r/.git/refs/heads/main.lock",
            "/r/.git/logs/HEAD",
            "/r/.git/COMMIT_EDITMSG",
            "/r/.git",
        ] {
            assert_eq!(classify_in(path), Change::Ignored, "{path}");
        }
    }

    #[test]
    fn reports_working_tree_paths_relative_to_the_root_and_drops_outside_paths() {
        assert_eq!(
            classify_in("/r/src/main.rs"),
            Change::WorkingTree(PathBuf::from("src/main.rs"))
        );
        assert_eq!(classify_in("/elsewhere/file"), Change::Ignored);
    }

    #[test]
    fn classifies_a_git_directory_outside_the_working_tree() {
        let dirs = vec![
            PathBuf::from("/main/.git/worktrees/wt"),
            PathBuf::from("/main/.git"),
        ];
        let classify_wt = |path: &str| classify(Path::new(path), Path::new("/wt"), &dirs);
        assert_eq!(
            classify_wt("/main/.git/worktrees/wt/index"),
            Change::Relevant
        );
        assert_eq!(classify_wt("/main/.git/refs/heads/x"), Change::Relevant);
        assert_eq!(classify_wt("/wt/.git"), Change::Ignored);
    }
}
