use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::repo;

pub fn tracked_files(path: &Path) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    let output = git::run(&root, &["ls-files", "-z"])?;
    let mut files: Vec<String> = output
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect();
    files.sort();
    Ok(files)
}
