use std::fs;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::CoreError;
use crate::git;
use crate::repo;

const ATTRIBUTES: &str = ".gitattributes";
const LFS_FILTER: &str = "filter=lfs";
const NOT_INSTALLED: &str = "Git LFS is not installed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct LfsStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub initialized: bool,
    pub patterns: Vec<String>,
}

fn parse_version(output: &str) -> Option<String> {
    let rest = output.trim().strip_prefix("git-lfs/")?;
    rest.split_whitespace().next().map(str::to_owned)
}

fn installed_version(root: &Path) -> Result<Option<String>, CoreError> {
    let completed = git::run_unchecked(root, &["lfs", "version"], None)?;
    Ok(completed
        .succeeded()
        .then(|| parse_version(&completed.stdout))
        .flatten())
}

fn require_installed(root: &Path) -> Result<(), CoreError> {
    installed_version(root)?
        .map(drop)
        .ok_or_else(|| CoreError::InvalidChoice {
            detail: NOT_INSTALLED.to_owned(),
        })
}

fn tracked_patterns(text: &str) -> Vec<String> {
    let mut patterns: Vec<String> = Vec::new();
    for line in text.lines() {
        let mut words = line.split_whitespace();
        let Some(pattern) = words.next().filter(|word| !word.starts_with('#')) else {
            continue;
        };
        if words.any(|word| word == LFS_FILTER) && !patterns.iter().any(|known| known == pattern) {
            patterns.push(pattern.to_owned());
        }
    }
    patterns
}

fn read_attributes(root: &Path) -> Result<String, CoreError> {
    match fs::read_to_string(root.join(ATTRIBUTES)) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(attributes_failure(&error)),
    }
}

fn attributes_failure(error: &std::io::Error) -> CoreError {
    CoreError::GitFailed {
        command: format!("write {ATTRIBUTES}"),
        status: None,
        stderr: error.to_string(),
    }
}

fn valid_pattern(pattern: &str) -> Result<&str, CoreError> {
    let pattern = pattern.trim();
    if pattern.is_empty()
        || pattern.starts_with('#')
        || pattern
            .chars()
            .any(|letter| letter.is_whitespace() || letter.is_control())
    {
        return Err(CoreError::invalid_request(
            "enter a pattern such as *.psd or assets/**, without spaces",
        ));
    }
    Ok(pattern)
}

pub fn lfs_status(path: &Path) -> Result<LfsStatus, CoreError> {
    let root = repo::open(path)?;
    let version = installed_version(&root)?;
    let initialized = git::run_unchecked(
        &root,
        &["config", "--local", "--get", "filter.lfs.clean"],
        None,
    )?
    .succeeded();
    Ok(LfsStatus {
        installed: version.is_some(),
        version,
        initialized,
        patterns: tracked_patterns(&read_attributes(&root)?),
    })
}

pub fn lfs_initialize(path: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_installed(&root)?;
    git::run(&root, &["lfs", "install", "--local"]).map(drop)
}

pub fn lfs_track(path: &Path, pattern: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_installed(&root)?;
    let pattern = valid_pattern(pattern)?;
    let mut text = read_attributes(&root)?;
    if tracked_patterns(&text).iter().any(|known| known == pattern) {
        return Err(CoreError::invalid_request(format!(
            "{pattern} is already tracked by Git LFS"
        )));
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&format!(
        "{pattern} {LFS_FILTER} diff=lfs merge=lfs -text\n"
    ));
    fs::write(root.join(ATTRIBUTES), text).map_err(|error| attributes_failure(&error))
}

pub fn lfs_untrack(path: &Path, pattern: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_installed(&root)?;
    let pattern = valid_pattern(pattern)?;
    let text = read_attributes(&root)?;
    let mut removed = false;
    let kept: String = text
        .split_inclusive('\n')
        .filter(|line| {
            let mut words = line.split_whitespace();
            let tracked = words.next() == Some(pattern) && words.any(|word| word == LFS_FILTER);
            removed |= tracked;
            !tracked
        })
        .collect();
    if !removed {
        return Err(CoreError::invalid_request(format!(
            "{pattern} is not tracked by Git LFS"
        )));
    }
    fs::write(root.join(ATTRIBUTES), kept).map_err(|error| attributes_failure(&error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_version_from_git_lfs_output() {
        assert_eq!(
            parse_version("git-lfs/3.5.1 (GitHub; darwin arm64; go 1.21.8)\n").as_deref(),
            Some("3.5.1")
        );
        assert_eq!(parse_version("something else"), None);
    }

    #[test]
    fn lists_only_lfs_patterns_once_in_file_order() {
        let text = "# comment\n*.psd filter=lfs diff=lfs merge=lfs -text\n*.txt text\n*.zip -text filter=lfs\n*.psd filter=lfs\n";
        assert_eq!(tracked_patterns(text), ["*.psd", "*.zip"]);
    }
}
