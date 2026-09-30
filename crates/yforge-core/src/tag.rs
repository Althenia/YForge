use std::path::Path;

use crate::branch::{self, ref_exists};
use crate::error::CoreError;
use crate::git::{self, CancelToken};
use crate::refs;
use crate::repo;
use crate::sync::{run_network, Progress};

fn validated_name(root: &Path, name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::invalid_request("enter a tag name"));
    }
    let completed = git::run_unchecked(
        root,
        &["check-ref-format", &format!("refs/tags/{name}")],
        None,
    )?;
    if completed.succeeded() {
        Ok(())
    } else {
        Err(CoreError::invalid_request(format!(
            "{name:?} is not a valid tag name"
        )))
    }
}

fn require_tag(root: &Path, name: &str) -> Result<String, CoreError> {
    let full = format!("refs/tags/{name}");
    if ref_exists(root, &full)? {
        Ok(full)
    } else {
        Err(CoreError::invalid_request(format!(
            "there is no tag {name}"
        )))
    }
}

fn require_remote(root: &Path, remote: &str) -> Result<(), CoreError> {
    if refs::read_remotes(root)?
        .iter()
        .any(|known| known == remote)
    {
        Ok(())
    } else {
        Err(CoreError::invalid_request(format!(
            "{remote} is not a remote of this repository"
        )))
    }
}

pub fn create_tag(
    path: &Path,
    name: &str,
    at: Option<&str>,
    message: Option<&str>,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    validated_name(&root, name)?;
    if ref_exists(&root, &format!("refs/tags/{name}"))? {
        return Err(CoreError::invalid_request(format!(
            "a tag named {name} already exists"
        )));
    }
    if let Some(sha) = at {
        branch::require_start_point(&root, sha)?;
    }
    let mut args = vec!["tag"];
    match message.map(str::trim) {
        Some("") => {
            return Err(CoreError::invalid_request(
                "enter a message for the annotated tag",
            ))
        }
        Some(text) => args.extend(["--annotate", "--message", text]),
        None => {}
    }
    args.push(name);
    args.extend(at);
    git::run(&root, &args).map(drop)
}

pub fn delete_tag(path: &Path, name: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_tag(&root, name)?;
    git::run(&root, &["tag", "--delete", name]).map(drop)
}

pub fn push_tag(
    path: &Path,
    remote: &str,
    name: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_remote(&root, remote)?;
    let full = require_tag(&root, name)?;
    let refspec = format!("{full}:{full}");
    run_network(
        &root,
        &["push", "--progress", remote, &refspec],
        remote,
        cancel,
        on_progress,
    )
}

pub fn delete_remote_tag(
    path: &Path,
    remote: &str,
    name: &str,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_remote(&root, remote)?;
    validated_name(&root, name)?;
    let full = format!("refs/tags/{name}");
    run_network(
        &root,
        &["push", "--progress", remote, "--delete", &full],
        remote,
        cancel,
        on_progress,
    )
}
