use std::fs;
use std::path::Path;

use crate::activity::redact;
use crate::error::CoreError;
use crate::git::{self, CancelToken};
use crate::repo;
use crate::sync::{run_network, Progress};

pub(crate) fn valid_url(url: &str) -> bool {
    let has_scheme = ["https://", "http://", "ssh://", "git://", "file://"]
        .iter()
        .any(|scheme| url.starts_with(scheme) && url.len() > scheme.len());
    let scp_like = url.split_once(':').is_some_and(|(host, path)| {
        !host.is_empty() && !host.contains('/') && !path.is_empty() && !path.starts_with("//")
    });
    has_scheme || scp_like || Path::new(url).is_absolute()
}

fn is_empty_directory(path: &Path) -> Result<bool, CoreError> {
    let mut entries = fs::read_dir(path).map_err(|error| io_failure("read", path, &error))?;
    Ok(entries.next().is_none())
}

fn io_failure(verb: &str, path: &Path, error: &std::io::Error) -> CoreError {
    CoreError::invalid_request(format!("could not {verb} {}: {error}", path.display()))
}

pub fn clone_repository(
    url: &str,
    destination: &Path,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<String, CoreError> {
    git::ensure_supported()?;
    let url = url.trim();
    if !valid_url(url) {
        return Err(CoreError::invalid_request(format!(
            "{} is not an https, ssh, or local repository address",
            redact(url)
        )));
    }
    if !destination.is_absolute() {
        return Err(CoreError::invalid_request(
            "the clone destination must be an absolute path",
        ));
    }
    let existed = destination.exists();
    if existed && !(destination.is_dir() && is_empty_directory(destination)?) {
        return Err(CoreError::invalid_request(format!(
            "{} already exists and is not empty",
            destination.display()
        )));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| CoreError::invalid_request("the clone destination has no parent folder"))?;
    fs::create_dir_all(parent).map_err(|error| io_failure("create", parent, &error))?;
    let target = destination.to_string_lossy();
    let result = run_network(
        parent,
        &["clone", "--progress", "--", url, &target],
        &redact(url),
        cancel,
        on_progress,
    );
    if let Err(error) = result {
        if destination.exists() {
            let removal = if existed {
                fs::read_dir(destination).and_then(|entries| {
                    entries.flatten().try_for_each(|entry| {
                        fs::remove_dir_all(entry.path()).or_else(|_| fs::remove_file(entry.path()))
                    })
                })
            } else {
                fs::remove_dir_all(destination)
            };
            removal.map_err(|failure| {
                io_failure("remove the partial clone in", destination, &failure)
            })?;
        }
        return Err(error);
    }
    Ok(repo::resolve_root(destination)?
        .to_string_lossy()
        .into_owned())
}

pub(crate) fn valid_default_branch(name: &str) -> Result<String, CoreError> {
    let branch = name.trim();
    let checked = git::run_unchecked(
        &std::env::temp_dir(),
        &["check-ref-format", "--branch", branch],
        None,
    )?;
    if branch.is_empty() || !checked.succeeded() {
        return Err(CoreError::invalid_request(format!(
            "{branch:?} is not a valid branch name"
        )));
    }
    Ok(branch.to_owned())
}

pub fn init_repository(path: &Path, default_branch: &str) -> Result<String, CoreError> {
    git::ensure_supported()?;
    if !path.is_absolute() {
        return Err(CoreError::invalid_request(
            "the repository path must be an absolute path",
        ));
    }
    fs::create_dir_all(path).map_err(|error| io_failure("create", path, &error))?;
    let canonical = path
        .canonicalize()
        .map_err(|error| io_failure("read", path, &error))?;
    if let Ok(root) = repo::resolve_root(&canonical) {
        if root.canonicalize().ok().as_deref() == Some(canonical.as_path()) {
            return Err(CoreError::AlreadyARepository {
                path: canonical.to_string_lossy().into_owned(),
            });
        }
    }
    let branch = valid_default_branch(default_branch)?;
    git::run(&canonical, &["init", "--quiet", "-b", &branch])?;
    Ok(canonical.to_string_lossy().into_owned())
}
