use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::commit::validate_sha;
use crate::conflict::majority_eol;
use crate::error::CoreError;
use crate::git;
use crate::model::FileAtRevision;
use crate::repo;

pub(crate) const FILE_VIEW_LIMIT: u64 = 2 * 1024 * 1024;

const INDEX: &str = ":index";
const WORKTREE: &str = ":worktree";

fn absent(file: &str, revision: &str) -> CoreError {
    CoreError::invalid_request(format!("{file} is not a file in {revision}"))
}

fn checked_size(file: &str, size: u64) -> Result<(), CoreError> {
    if size > FILE_VIEW_LIMIT {
        return Err(CoreError::FileTooLarge {
            file: file.to_owned(),
            size,
            limit: FILE_VIEW_LIMIT,
        });
    }
    Ok(())
}

fn blob_bytes(root: &Path, spec: &str, file: &str, revision: &str) -> Result<Vec<u8>, CoreError> {
    let kind = git::run_unchecked(root, &["cat-file", "-t", spec], None)?;
    if !kind.succeeded() || kind.stdout.trim() != "blob" {
        return Err(absent(file, revision));
    }
    let size = git::run(root, &["cat-file", "-s", spec])?
        .trim()
        .parse::<u64>()
        .map_err(|_| CoreError::invalid_output("git cat-file -s", "the size is not a number"))?;
    checked_size(file, size)?;
    git::run_bytes(root, &["cat-file", "blob", spec])
}

fn worktree_bytes(root: &Path, file: &str) -> Result<Vec<u8>, CoreError> {
    let failure = |target: &Path, error: std::io::Error| CoreError::GitFailed {
        command: format!("read {}", target.display()),
        status: None,
        stderr: error.to_string(),
    };
    let relative: PathBuf = Path::new(file)
        .components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect();
    let expected = root
        .canonicalize()
        .map_err(|error| failure(root, error))?
        .join(&relative);
    let target = root.join(&relative);
    let resolved = target.canonicalize().map_err(|_| absent(file, WORKTREE))?;
    if resolved != expected {
        return Err(CoreError::invalid_request(format!(
            "{file} is or sits behind a symbolic link"
        )));
    }
    let metadata = fs::metadata(&resolved).map_err(|error| failure(&resolved, error))?;
    if !metadata.is_file() {
        return Err(absent(file, WORKTREE));
    }
    checked_size(file, metadata.len())?;
    fs::read(&resolved).map_err(|error| failure(&resolved, error))
}

pub fn file_at_revision(
    path: &Path,
    file: &str,
    revision: &str,
) -> Result<FileAtRevision, CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let bytes = match revision {
        WORKTREE => worktree_bytes(&root, file)?,
        INDEX => blob_bytes(&root, &format!(":0:{file}"), file, revision)?,
        sha => {
            validate_sha(sha)?;
            blob_bytes(&root, &format!("{sha}:{file}"), file, revision)?
        }
    };
    let size = bytes.len() as u64;
    let text = (!bytes.contains(&0))
        .then(|| String::from_utf8(bytes).ok())
        .flatten();
    Ok(match text {
        Some(text) => FileAtRevision::Text {
            eol: majority_eol(&text).to_owned(),
            text,
            size,
        },
        None => FileAtRevision::Binary { size },
    })
}
