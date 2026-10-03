use std::path::Path;

use crate::error::CoreError;
use crate::git::{self, CancelToken};
use crate::repo;
use crate::sync::Progress;

const TASKS: [&str; 4] = [
    "--task=gc",
    "--task=commit-graph",
    "--task=loose-objects",
    "--task=incremental-repack",
];

pub fn maintenance_run(
    path: &Path,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let mut args = vec!["maintenance", "run"];
    args.extend(TASKS);
    on_progress(Progress {
        phase: "Running repository maintenance".to_owned(),
        percent: None,
    });
    let completed = git::run_streaming(&root, &args, cancel, |line| {
        if let Some((phase, percent)) = git::parse_progress(line) {
            on_progress(Progress {
                phase,
                percent: Some(percent),
            });
        }
    })?;
    if completed.succeeded() {
        return Ok(());
    }
    Err(CoreError::GitFailed {
        command: format!("git {}", args.join(" ")),
        status: completed.status,
        stderr: completed.stderr.trim().to_owned(),
    })
}
