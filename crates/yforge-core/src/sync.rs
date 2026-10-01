use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;

use crate::activity::redact;
use crate::branch;
use crate::commit::validate_sha;
use crate::error::CoreError;
use crate::git::{self, CancelToken, Completed};
use crate::integrate;
use crate::model::{
    ForceLease, ForcePushPlan, Operation, PullMode, PullOutcome, PullReport, PullStash,
    StashKeptReason, StashRestore,
};
use crate::recovery::git_path;
use crate::refs;
use crate::repo;
use crate::stash;

const AUTH_MARKERS: [&str; 11] = [
    "host key verification failed",
    "authentication failed",
    "could not read username",
    "could not read password",
    "terminal prompts disabled",
    "permission denied (publickey",
    "permission denied, please try again",
    "invalid username or password",
    "access denied",
    "returned error: 401",
    "returned error: 403",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Progress {
    pub phase: String,
    pub percent: Option<u32>,
}

struct Tracking {
    remote: String,
    merge_ref: String,
    ref_name: String,
    short: String,
}

fn tracking(root: &Path, branch: &str) -> Result<Option<Tracking>, CoreError> {
    let output = git::run(
        root,
        &[
            "for-each-ref",
            "--format=%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)",
            &format!("refs/heads/{branch}"),
        ],
    )?;
    let line = output.trim_end_matches('\n');
    let fields: Vec<&str> = line.split('\0').collect();
    let [ref_name, short, remote, merge_ref] = fields[..] else {
        return Err(CoreError::invalid_output(
            "git for-each-ref",
            format!("expected 4 fields in {line:?}"),
        ));
    };
    if ref_name.is_empty() {
        return Ok(None);
    }
    Ok(Some(Tracking {
        remote: remote.to_owned(),
        merge_ref: merge_ref.to_owned(),
        ref_name: ref_name.to_owned(),
        short: short.to_owned(),
    }))
}

fn checked_out_branch(root: &Path, verb: &str) -> Result<String, CoreError> {
    branch::current_branch(root)?
        .ok_or_else(|| CoreError::invalid_request(format!("check out a branch before you {verb}")))
}

fn require_tracking(root: &Path, branch: &str) -> Result<Tracking, CoreError> {
    tracking(root, branch)?
        .ok_or_else(|| CoreError::invalid_request(format!("{branch} has no upstream branch")))
}

fn classify(remote: &str, mut completed: Completed, command: String) -> CoreError {
    completed.stderr = redact(&completed.stderr);
    let lowered = completed.stderr.to_lowercase();
    if AUTH_MARKERS.iter().any(|marker| lowered.contains(marker)) {
        return CoreError::AuthFailed {
            remote: remote.to_owned(),
            detail: completed.stderr,
        };
    }
    if completed.stderr.contains("[rejected]") || completed.stderr.contains("[remote rejected]") {
        return CoreError::PushRejected {
            detail: completed.stderr,
        };
    }
    CoreError::GitFailed {
        command,
        status: completed.status,
        stderr: completed.stderr,
    }
}

pub(crate) fn run_network(
    root: &Path,
    args: &[&str],
    remote: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let mut lookup = vec!["remote", "get-url"];
    if args.first() == Some(&"push") {
        lookup.push("--push");
    }
    lookup.push(remote);
    let url = git::run_unchecked(root, &lookup, None)
        .ok()
        .filter(Completed::succeeded)
        .map(|completed| completed.stdout.trim().to_owned());
    run_routed(
        root,
        args,
        remote,
        &cancel.toward(url.as_deref()),
        on_progress,
    )
}

pub(crate) fn run_routed(
    root: &Path,
    args: &[&str],
    remote: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let mut last: Option<(String, u32)> = None;
    let completed = git::run_streaming(root, args, cancel, |line| {
        if let Some(update) = git::parse_progress(line) {
            if last.as_ref() != Some(&update) {
                on_progress(Progress {
                    phase: update.0.clone(),
                    percent: Some(update.1),
                });
                last = Some(update);
            }
        }
    })?;
    if completed.succeeded() {
        Ok(())
    } else {
        Err(classify(
            remote,
            completed,
            redact(&format!("git {}", args.join(" "))),
        ))
    }
}

pub fn fetch(
    path: &Path,
    prune: bool,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let remotes = refs::read_remotes(&root)?;
    if remotes.is_empty() {
        return Err(CoreError::invalid_request("this repository has no remotes"));
    }
    keeping_fetch_head(&root, || {
        for remote in &remotes {
            on_progress(Progress {
                phase: format!("Fetching {remote}"),
                percent: None,
            });
            let mut args = vec!["fetch", "--progress"];
            if prune {
                args.push("--prune");
            }
            args.push(remote);
            run_network(&root, &args, remote, cancel, on_progress)?;
        }
        Ok(())
    })
}

fn keeping_fetch_head(
    root: &Path,
    fetch: impl FnOnce() -> Result<(), CoreError>,
) -> Result<(), CoreError> {
    let path = git_path(root, "FETCH_HEAD")?;
    let Ok(saved) = saved_fetch_head(&path) else {
        return fetch();
    };
    let result = fetch();
    let Err(error) = result else {
        return Ok(());
    };
    restore_fetch_head(&path, saved).map_err(|restore| CoreError::GitFailed {
        command: "git fetch".to_owned(),
        status: None,
        stderr: format!("{error}; FETCH_HEAD could not be restored: {restore}"),
    })?;
    Err(error)
}

fn saved_fetch_head(path: &Path) -> io::Result<Option<(Vec<u8>, SystemTime)>> {
    match fs::read(path) {
        Ok(content) => Ok(Some((content, fs::metadata(path)?.modified()?))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn restore_fetch_head(path: &Path, saved: Option<(Vec<u8>, SystemTime)>) -> io::Result<()> {
    match saved {
        Some((content, modified)) => {
            fs::write(path, content)?;
            fs::File::options()
                .write(true)
                .open(path)?
                .set_modified(modified)
        }
        None => match fs::remove_file(path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        },
    }
}

fn head_sha(root: &Path) -> Result<String, CoreError> {
    Ok(git::run(root, &["rev-parse", "HEAD"])?.trim().to_owned())
}

fn fetch_upstream(
    root: &Path,
    upstream: &Tracking,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    if upstream.remote != "." {
        keeping_fetch_head(root, || {
            run_network(
                root,
                &["fetch", "--progress", &upstream.remote],
                &upstream.remote,
                cancel,
                on_progress,
            )
        })?;
    }
    if cancel.is_cancelled() {
        return Err(CoreError::Cancelled);
    }
    Ok(())
}

fn integrate_upstream(
    root: &Path,
    mode: PullMode,
    upstream: &Tracking,
) -> Result<PullOutcome, CoreError> {
    let before = head_sha(root)?;
    let args: Vec<&str> = match mode {
        PullMode::FastForwardOnly => vec!["merge", "--ff-only", &upstream.short],
        PullMode::FastForwardOrMerge => vec!["merge", "--no-edit", &upstream.short],
        PullMode::Rebase => vec!["rebase", &upstream.short],
    };
    let completed = git::run_unchecked(root, &args, None)?;
    if completed.succeeded() {
        return Ok(if head_sha(root)? == before {
            PullOutcome::UpToDate
        } else {
            PullOutcome::Updated
        });
    }
    if repo::read_operation(root)?
        .0
        .is_some_and(|operation| operation != Operation::Bisect)
    {
        return Ok(PullOutcome::Conflicts);
    }
    if mode == PullMode::FastForwardOnly
        && completed.stderr.contains("Not possible to fast-forward")
    {
        return Err(CoreError::NotFastForward {
            detail: completed.stderr.trim().to_owned(),
        });
    }
    Err(branch::classify_local_changes(CoreError::GitFailed {
        command: format!("git {}", args.join(" ")),
        status: completed.status,
        stderr: format!("{}{}", completed.stdout, completed.stderr)
            .trim()
            .to_owned(),
    }))
}

pub fn pull(
    path: &Path,
    mode: PullMode,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<PullOutcome, CoreError> {
    let root = repo::open(path)?;
    let branch = checked_out_branch(&root, "pull")?;
    let upstream = require_tracking(&root, &branch)?;
    fetch_upstream(&root, &upstream, cancel, on_progress)?;
    integrate_upstream(&root, mode, &upstream)
}

const TOP_STASH: &str = "stash@{0}";

pub fn pull_autostash(
    path: &Path,
    mode: PullMode,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<PullReport, CoreError> {
    let root = repo::open(path)?;
    let branch = checked_out_branch(&root, "pull")?;
    let upstream = require_tracking(&root, &branch)?;
    fetch_upstream(&root, &upstream, cancel, on_progress)?;
    let dirty = repo::read_status(&root)?.counts.total() > 0;
    let message = format!("YForge: auto-stash before pulling {}", upstream.short);
    if !dirty || !stash::push_auto(&root, &message, true)? {
        return Ok(PullReport {
            outcome: integrate_upstream(&root, mode, &upstream)?,
            stash: PullStash::None,
        });
    }
    let sha = stash::top_stash(&root)?.unwrap_or_default();
    let kept = |reason| PullStash::Kept {
        reference: TOP_STASH.to_owned(),
        sha: sha.clone(),
        reason,
    };
    match integrate_upstream(&root, mode, &upstream) {
        Err(failure) => Err(match stash::restore(&root, &["stash", "pop", "--quiet"]) {
            Ok(StashRestore::Applied) => failure,
            _ => CoreError::invalid_request(format!(
                "{failure}; your stashed changes could not be restored and remain in {TOP_STASH}"
            )),
        }),
        Ok(PullOutcome::Conflicts) => Ok(PullReport {
            outcome: PullOutcome::Conflicts,
            stash: kept(StashKeptReason::PullConflicts),
        }),
        Ok(outcome) => Ok(PullReport {
            outcome,
            stash: match stash::restore(&root, &["stash", "pop", "--quiet"]) {
                Ok(StashRestore::Applied) => PullStash::Restored,
                Ok(StashRestore::Conflicts) => kept(StashKeptReason::RestoreConflicts),
                Err(_) => kept(StashKeptReason::RestoreFailed),
            },
        }),
    }
}

pub fn push(
    path: &Path,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let branch = checked_out_branch(&root, "push")?;
    let local = format!("refs/heads/{branch}");
    if let Some(upstream) = tracking(&root, &branch)? {
        if upstream.remote == "." {
            return Err(CoreError::invalid_request(format!(
                "{branch} tracks a local branch; there is no remote to push to"
            )));
        }
        let refspec = format!("{local}:{}", upstream.merge_ref);
        return run_network(
            &root,
            &["push", "--progress", &upstream.remote, &refspec],
            &upstream.remote,
            cancel,
            on_progress,
        );
    }
    let remotes = refs::read_remotes(&root)?;
    let remote = if remotes.iter().any(|remote| remote == "origin") {
        "origin"
    } else {
        remotes
            .first()
            .map(String::as_str)
            .ok_or_else(|| CoreError::invalid_request("this repository has no remotes"))?
    };
    publish_branch(&root, &branch, remote, cancel, on_progress)
}

fn publish_branch(
    root: &Path,
    branch: &str,
    remote: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let local = format!("refs/heads/{branch}");
    let refspec = format!("{local}:{local}");
    run_network(
        root,
        &["push", "--progress", "--set-upstream", remote, &refspec],
        remote,
        cancel,
        on_progress,
    )
}

pub fn publish(
    path: &Path,
    remote: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let branch = checked_out_branch(&root, "publish")?;
    if !refs::read_remotes(&root)?.iter().any(|name| name == remote) {
        return Err(CoreError::invalid_request(format!(
            "{remote} is not a remote of this repository"
        )));
    }
    if !branch::ref_exists(&root, &format!("refs/heads/{branch}"))? {
        return Err(CoreError::invalid_request(
            "make a first commit before you publish",
        ));
    }
    publish_branch(&root, &branch, remote, cancel, on_progress)
}

pub fn remote_branch_sha(
    path: &Path,
    remote: &str,
    name: &str,
) -> Result<Option<String>, CoreError> {
    let root = repo::open(path)?;
    let full = format!("refs/remotes/{remote}/{name}");
    let completed = git::run_unchecked(&root, &["rev-parse", "--verify", "--quiet", &full], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned()))
}

pub fn delete_remote_branch(
    path: &Path,
    remote: &str,
    name: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    refs::require_remote(&root, remote)?;
    branch::validated_name(&root, name)?;
    let full = format!("refs/heads/{name}");
    run_network(
        &root,
        &["push", "--progress", remote, "--delete", &full],
        remote,
        cancel,
        on_progress,
    )
}

pub fn push_to(
    path: &Path,
    remote: &str,
    name: &str,
    set_upstream: bool,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let current = checked_out_branch(&root, "push")?;
    refs::require_remote(&root, remote)?;
    branch::validated_name(&root, name)?;
    let refspec = format!("refs/heads/{current}:refs/heads/{name}");
    let mut args = vec!["push", "--progress"];
    if set_upstream {
        args.push("--set-upstream");
    }
    args.extend([remote, &refspec]);
    run_network(&root, &args, remote, cancel, on_progress)
}

pub fn push_plan(path: &Path) -> Result<ForcePushPlan, CoreError> {
    let root = repo::open(path)?;
    let branch = checked_out_branch(&root, "force push")?;
    let upstream = require_tracking(&root, &branch)?;
    if upstream.remote == "." {
        return Err(CoreError::invalid_request(format!(
            "{branch} tracks a local branch; there is no remote to push to"
        )));
    }
    let range = format!("HEAD..{}", upstream.ref_name);
    let replaced = integrate::range(&root, &[&range])?;
    if replaced.count == 0 {
        return Err(CoreError::invalid_request(format!(
            "{} has no commits that a force push would replace",
            upstream.short
        )));
    }
    let expected_sha = git::run(&root, &["rev-parse", &upstream.ref_name])?
        .trim()
        .to_owned();
    Ok(ForcePushPlan {
        lease: ForceLease {
            remote: upstream.remote,
            branch,
            remote_ref: upstream.merge_ref,
            expected_sha,
        },
        upstream: upstream.short,
        replaced,
    })
}

pub fn push_force(
    path: &Path,
    lease: &ForceLease,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    validate_sha(&lease.expected_sha)?;
    if !refs::read_remotes(&root)?.contains(&lease.remote) {
        return Err(CoreError::invalid_request(format!(
            "{} is not a remote of this repository",
            lease.remote
        )));
    }
    let local = format!("refs/heads/{}", lease.branch);
    if !branch::ref_exists(&root, &local)? {
        return Err(CoreError::invalid_request(format!(
            "there is no local branch {}",
            lease.branch
        )));
    }
    if !lease.remote_ref.starts_with("refs/heads/") {
        return Err(CoreError::invalid_request(format!(
            "{} is not a branch on the remote",
            lease.remote_ref
        )));
    }
    let with_lease = format!(
        "--force-with-lease={}:{}",
        lease.remote_ref, lease.expected_sha
    );
    let refspec = format!("{local}:{}", lease.remote_ref);
    run_network(
        &root,
        &["push", "--progress", &with_lease, &lease.remote, &refspec],
        &lease.remote,
        cancel,
        on_progress,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failed(stderr: &str) -> Completed {
        Completed {
            status: Some(128),
            stdout: String::new(),
            stderr: stderr.to_owned(),
        }
    }

    #[test]
    fn classifies_credential_failures_as_authentication_errors_for_the_remote() {
        for stderr in [
            "fatal: could not read Username for 'https://example.test': terminal prompts disabled",
            "remote: Invalid username or password.\nfatal: Authentication failed for 'https://example.test/r.git/'",
            "git@example.test: Permission denied (publickey).\nfatal: Could not read from remote repository.",
            "fatal: unable to access 'https://example.test/r.git/': The requested URL returned error: 403",
        ] {
            let error = classify("origin", failed(stderr), "git fetch".into());
            assert!(
                matches!(&error, CoreError::AuthFailed { remote, .. } if remote == "origin"),
                "{stderr}: {error:?}"
            );
        }
    }

    #[test]
    fn classifies_rejected_pushes_and_leaves_other_failures_untyped() {
        let rejected = classify(
            "origin",
            failed(" ! [rejected]        main -> main (non-fast-forward)"),
            "git push".into(),
        );
        assert!(matches!(rejected, CoreError::PushRejected { .. }));
        let other = classify(
            "origin",
            failed("fatal: unable to access 'http://127.0.0.1:1/r.git/': Failed to connect"),
            "git fetch".into(),
        );
        assert!(matches!(other, CoreError::GitFailed { .. }));
    }
}
