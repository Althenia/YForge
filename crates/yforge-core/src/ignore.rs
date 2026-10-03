use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::repo;
use crate::stage;

fn pattern(file: &str) -> Result<String, CoreError> {
    if file.contains(['\n', '\r']) {
        return Err(CoreError::invalid_request(format!(
            "{file:?} has a line break in its name, which .gitignore cannot hold"
        )));
    }
    let mut escaped = String::from("/");
    for character in file.chars() {
        if matches!(character, '\\' | '*' | '?' | '[') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    let kept = escaped.trim_end_matches(' ').len();
    let trailing = escaped.len() - kept;
    escaped.truncate(kept);
    escaped.push_str(&"\\ ".repeat(trailing));
    Ok(escaped)
}

fn failure(target: &Path, error: &std::io::Error) -> CoreError {
    CoreError::GitFailed {
        command: format!("write {}", target.display()),
        status: None,
        stderr: error.to_string(),
    }
}

pub fn ignore_paths(path: &Path, files: &[String], untrack: bool) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(files)?;
    let patterns = files
        .iter()
        .map(|file| pattern(file))
        .collect::<Result<Vec<_>, _>>()?;
    let target = root.join(".gitignore");
    let existing = match fs::read_to_string(&target) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => String::new(),
        Err(error) => return Err(failure(&target, &error)),
    };
    let mut known: Vec<&str> = existing
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .collect();
    let mut appended = String::new();
    for pattern in &patterns {
        if !known.contains(&pattern.as_str()) {
            known.push(pattern);
            appended.push_str(pattern);
            appended.push('\n');
        }
    }
    if !appended.is_empty() {
        let separator = if existing.is_empty() || existing.ends_with('\n') {
            ""
        } else {
            "\n"
        };
        fs::write(&target, format!("{existing}{separator}{appended}"))
            .map_err(|error| failure(&target, &error))?;
    }
    if untrack {
        git::run(
            &root,
            &stage::with_paths(
                &["rm", "--cached", "--force", "--quiet", "--ignore-unmatch"],
                files,
            ),
        )?;
    }
    Ok(())
}
