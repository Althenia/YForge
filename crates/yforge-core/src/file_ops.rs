use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::conflict::majority_eol;
use crate::error::CoreError;
use crate::git;
use crate::operation;
use crate::repo;
use crate::snapshots::{self, Action};
use crate::undo;

const EDIT_LIMIT: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct EditableFile {
    pub text: String,
    pub eol: String,
    pub size: u64,
}

fn io_failure(target: &Path, error: &std::io::Error) -> CoreError {
    CoreError::GitFailed {
        command: format!("write {}", target.display()),
        status: None,
        stderr: error.to_string(),
    }
}

fn not_a_file(file: &str) -> CoreError {
    CoreError::invalid_request(format!("{file} is not a file in the working tree"))
}

fn behind_link(file: &str) -> CoreError {
    CoreError::invalid_request(format!("{file} is or sits behind a symbolic link"))
}

fn relative(file: &str) -> PathBuf {
    Path::new(file)
        .components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect()
}

fn worktree_file(root: &Path, file: &str) -> Result<PathBuf, CoreError> {
    repo::check_paths(&[file])?;
    let expected = root
        .canonicalize()
        .map_err(|error| io_failure(root, &error))?
        .join(relative(file));
    let resolved = root
        .join(relative(file))
        .canonicalize()
        .map_err(|_| not_a_file(file))?;
    if resolved != expected {
        return Err(behind_link(file));
    }
    if !fs::metadata(&resolved).is_ok_and(|metadata| metadata.is_file()) {
        return Err(not_a_file(file));
    }
    Ok(resolved)
}

pub fn create_file(path: &Path, file: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let relative = relative(file);
    if relative
        .components()
        .any(|component| component.as_os_str() == ".git")
    {
        return Err(CoreError::invalid_request(format!(
            "{file} is inside .git, which belongs to Git"
        )));
    }
    let mut ancestor = PathBuf::new();
    let parts: Vec<Component> = relative.components().collect();
    for component in &parts[..parts.len().saturating_sub(1)] {
        ancestor.push(component);
        let shown = ancestor.to_string_lossy();
        match fs::symlink_metadata(root.join(&ancestor)) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(behind_link(&shown)),
            Ok(metadata) if !metadata.is_dir() => {
                return Err(CoreError::invalid_request(format!("{shown} is a file")));
            }
            _ => {}
        }
    }
    let target = root.join(&relative);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(CoreError::invalid_request(format!("{file} already exists")));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| io_failure(parent, &error))?;
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map(drop)
        .map_err(|error| io_failure(&target, &error))
}

pub fn delete_file(path: &Path, file: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let target = worktree_file(&root, file)?;
    snapshots::capture(&root, Action::Discard, &format!("Delete {file}"), None)?;
    fs::remove_file(&target).map_err(|error| io_failure(&target, &error))
}

pub fn worktree_files(path: &Path) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    let listing = git::run(
        &root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;
    let mut files: Vec<String> = listing
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .filter(|entry| {
            fs::symlink_metadata(root.join(entry)).is_ok_and(|metadata| metadata.is_file())
        })
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

fn mebibytes(size: u64) -> String {
    format!("{:.1} MiB", size as f64 / (1024.0 * 1024.0))
}

pub fn file_editable(path: &Path, file: &str) -> Result<EditableFile, CoreError> {
    let root = repo::open(path)?;
    let target = worktree_file(&root, file)?;
    let size = fs::metadata(&target)
        .map_err(|error| io_failure(&target, &error))?
        .len();
    if size > EDIT_LIMIT {
        return Err(CoreError::invalid_request(format!(
            "{file} is {}, over the 1 MiB limit of the editor",
            mebibytes(size)
        )));
    }
    let bytes = fs::read(&target).map_err(|error| io_failure(&target, &error))?;
    let text = (!bytes.contains(&0))
        .then(|| String::from_utf8(bytes).ok())
        .flatten()
        .ok_or_else(|| {
            CoreError::invalid_request(format!(
                "{file} is a binary file; the editor opens text files only"
            ))
        })?;
    Ok(EditableFile {
        eol: majority_eol(&text).to_owned(),
        text,
        size,
    })
}

pub fn file_save(path: &Path, file: &str, text: &str, eol: &str) -> Result<(), CoreError> {
    if eol != "\n" && eol != "\r\n" {
        return Err(CoreError::invalid_request(
            "the line ending must be LF or CRLF",
        ));
    }
    let root = repo::open(path)?;
    let target = worktree_file(&root, file)?;
    let normalized = text.replace("\r\n", "\n");
    let content = if eol == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };
    fs::write(&target, content).map_err(|error| io_failure(&target, &error))
}

pub fn changed_paths(path: &Path) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    let mut paths: Vec<String> = Vec::new();
    for change in repo::read_status(&root)?.files {
        for name in std::iter::once(change.path).chain(change.original_path) {
            if !paths.contains(&name) {
                paths.push(name);
            }
        }
    }
    Ok(paths)
}

pub fn discard_all(path: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    operation::require_no_operation(&root)?;
    let count = changed_paths(&root)?.len();
    if count == 0 {
        return Err(CoreError::invalid_request(
            "there are no changes to discard",
        ));
    }
    snapshots::capture(
        &root,
        Action::Discard,
        &format!("Discard all changes ({count} path(s))"),
        None,
    )?;
    if undo::head_sha(&root)?.is_some() {
        git::run(&root, &["reset", "--hard", "--quiet", "HEAD"])?;
    } else {
        git::run(&root, &["read-tree", "--empty"])?;
    }
    git::run(&root, &["clean", "--force", "-d", "--quiet"]).map(drop)
}
