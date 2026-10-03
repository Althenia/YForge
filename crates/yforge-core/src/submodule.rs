use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::model::{Submodule, SubmoduleStatus};
use crate::repo;
use crate::stage;

const STATUS_COMMAND: &str = "git submodule status";

struct ModuleConfig {
    name: String,
    path: String,
    url: String,
    branch: Option<String>,
}

struct StatusLine {
    prefix: char,
    sha: String,
    path: String,
}

pub fn list_submodules(path: &Path) -> Result<Vec<Submodule>, CoreError> {
    let root = repo::open(path)?;
    let configs = read_gitmodules(&root)?;
    let status = parse_status(&git::run(&root, &["submodule", "status", "--recursive"])?)?;
    let recorded = parse_gitlinks(&git::run(&root, &["ls-files", "-s"])?);
    Ok(assemble(configs, status, recorded))
}

pub fn add_submodule(
    path: &Path,
    url: &str,
    submodule_path: &str,
    branch: Option<&str>,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[submodule_path])?;
    let url = url.trim();
    if url.is_empty() || url.contains('\n') || url.starts_with('-') {
        return Err(CoreError::invalid_request("Enter a URL"));
    }
    let branch = branch.map(str::trim).filter(|value| !value.is_empty());
    if branch.is_some_and(|value| value.contains('\n') || value.starts_with('-')) {
        return Err(CoreError::invalid_request("Enter a branch name"));
    }
    let mut args = vec!["submodule", "add"];
    if let Some(name) = branch {
        args.push("-b");
        args.push(name);
    }
    args.push("--");
    args.push(url);
    args.push(submodule_path);
    git::run(&root, &args).map(drop)
}

pub fn update_submodule(path: &Path, submodule_path: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[submodule_path])?;
    git::run(
        &root,
        &["submodule", "update", "--init", "--", submodule_path],
    )
    .map(drop)
}

pub fn update_submodules(path: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    git::run(&root, &["submodule", "update", "--init", "--recursive"]).map(drop)
}

pub fn deinit_submodule(path: &Path, submodule_path: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[submodule_path])?;
    git::run(&root, &["submodule", "deinit", "-f", "--", submodule_path]).map(drop)
}

pub fn stage_submodule(path: &Path, submodule_path: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[submodule_path])?;
    let known = list_submodules(&root)?
        .iter()
        .any(|entry| entry.path == submodule_path);
    if !known {
        return Err(CoreError::invalid_request(format!(
            "{submodule_path} is not a submodule"
        )));
    }
    stage::stage_files(&root, &[submodule_path.to_owned()])
}

fn read_gitmodules(root: &Path) -> Result<Vec<ModuleConfig>, CoreError> {
    match fs::read_to_string(root.join(".gitmodules")) {
        Ok(text) => Ok(parse_gitmodules(&text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(CoreError::invalid_output(STATUS_COMMAND, error.to_string())),
    }
}

fn parse_gitmodules(text: &str) -> Vec<ModuleConfig> {
    let mut modules = Vec::new();
    let mut current: Option<ModuleConfig> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if let Some(name) = line
            .strip_prefix("[submodule \"")
            .and_then(|rest| rest.strip_suffix("\"]"))
        {
            if let Some(done) = current.take() {
                if !done.path.is_empty() {
                    modules.push(done);
                }
            }
            current = Some(ModuleConfig {
                name: name.to_owned(),
                path: String::new(),
                url: String::new(),
                branch: None,
            });
        } else if let Some(module) = current.as_mut() {
            if let Some((key, value)) = line.split_once('=') {
                match key.trim() {
                    "path" => module.path = value.trim().to_owned(),
                    "url" => module.url = value.trim().to_owned(),
                    "branch" => module.branch = Some(value.trim().to_owned()),
                    _ => {}
                }
            }
        }
    }
    if let Some(done) = current {
        if !done.path.is_empty() {
            modules.push(done);
        }
    }
    modules
}

fn parse_status(output: &str) -> Result<Vec<StatusLine>, CoreError> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(parse_status_line)
        .collect()
}

fn parse_status_line(line: &str) -> Result<StatusLine, CoreError> {
    let mut chars = line.chars();
    let prefix = chars.next().ok_or_else(|| {
        CoreError::invalid_output(STATUS_COMMAND, format!("empty status {line:?}"))
    })?;
    if !matches!(prefix, ' ' | '+' | '-' | 'U') {
        return Err(CoreError::invalid_output(
            STATUS_COMMAND,
            format!("unknown status {line:?}"),
        ));
    }
    let rest = chars.as_str();
    let (sha, after) = rest.split_once(' ').ok_or_else(|| {
        CoreError::invalid_output(STATUS_COMMAND, format!("expected sha and path in {line:?}"))
    })?;
    if sha.len() < 4 || !sha.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CoreError::invalid_output(
            STATUS_COMMAND,
            format!("expected a sha in {line:?}"),
        ));
    }
    let path = match after.rfind(" (") {
        Some(index) if after.ends_with(')') => &after[..index],
        _ => after,
    };
    if path.is_empty() {
        return Err(CoreError::invalid_output(
            STATUS_COMMAND,
            format!("expected a path in {line:?}"),
        ));
    }
    Ok(StatusLine {
        prefix,
        sha: sha.to_owned(),
        path: path.to_owned(),
    })
}

fn parse_gitlinks(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let (meta, path) = line.split_once('\t')?;
            let mut parts = meta.split_whitespace();
            let mode = parts.next()?;
            let sha = parts.next()?;
            (mode == "160000").then(|| (path.to_owned(), sha.to_owned()))
        })
        .collect()
}

fn assemble(
    configs: Vec<ModuleConfig>,
    status: Vec<StatusLine>,
    gitlinks: Vec<(String, String)>,
) -> Vec<Submodule> {
    let by_status: BTreeMap<_, _> = status
        .into_iter()
        .map(|line| (line.path.clone(), line))
        .collect();
    let recorded_of: BTreeMap<_, _> = gitlinks.into_iter().collect();
    let mut seen = Vec::new();
    let mut rows = Vec::new();
    for config in configs {
        seen.push(config.path.clone());
        rows.push(row_from(
            config.name,
            config.path,
            config.url,
            config.branch,
            &by_status,
            &recorded_of,
        ));
    }
    for (path, line) in &by_status {
        if seen.iter().any(|item| item == path) {
            continue;
        }
        rows.push(row_from(
            path.clone(),
            line.path.clone(),
            String::new(),
            None,
            &by_status,
            &recorded_of,
        ));
    }
    rows
}

fn row_from(
    name: String,
    path: String,
    url: String,
    branch: Option<String>,
    status: &BTreeMap<String, StatusLine>,
    recorded_of: &BTreeMap<String, String>,
) -> Submodule {
    let line = status.get(&path);
    let prefix = line.map(|entry| entry.prefix);
    let gitlink = recorded_of.get(&path).cloned();
    let from_status = (prefix == Some('-'))
        .then(|| line.map(|entry| entry.sha.clone()))
        .flatten();
    let recorded = gitlink.or(from_status).unwrap_or_default();
    let checked_out = match prefix {
        Some('-') | None => None,
        _ => line.map(|entry| entry.sha.clone()),
    };
    let status = match prefix {
        Some('-') | None => SubmoduleStatus::Uninitialized,
        Some('U') => SubmoduleStatus::UpdateFailed,
        Some('+') => SubmoduleStatus::Dirty,
        _ if checked_out
            .as_deref()
            .is_some_and(|sha| !recorded.is_empty() && sha != recorded) =>
        {
            SubmoduleStatus::Dirty
        }
        _ => SubmoduleStatus::Current,
    };
    Submodule {
        name,
        path,
        url,
        branch,
        status,
        recorded,
        checked_out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_current_dirty_and_uninitialized_submodules() {
        let modules = parse_gitmodules(
            "[submodule \"vendor/core\"]\n\tpath = vendor/core\n\turl = git@example.com:sample/core.git\n[submodule \"vendor/theme\"]\n\tpath = vendor/theme\n\turl = git@example.com:sample/theme.git\n\tbranch = main\n[submodule \"ext/docs\"]\n\tpath = ext/docs\n\turl = git@example.com:sample/docs.git\n",
        );
        let status = parse_status(
            " a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 vendor/core (heads/main)\n+c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7a8b9c4d5 vendor/theme (heads/main)\n-11223344556677889900aabbccddeeff00112233 ext/docs\nU0000000000000000000000000000000000000000 vendor/broken (heads/main)\n",
        )
        .unwrap();
        let gitlinks = parse_gitlinks(
            "160000 a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 0\tvendor/core\n160000 9f0e1aa9f0e1aa9f0e1aa9f0e1aa9f0e1aa9f0e1 0\tvendor/theme\n160000 11223344556677889900aabbccddeeff00112233 0\text/docs\n",
        );
        let rows = assemble(modules, status, gitlinks);
        assert_eq!(rows[0].path, "vendor/core");
        assert_eq!(rows[0].status, SubmoduleStatus::Current);
        assert_eq!(
            rows[0].checked_out.as_deref(),
            Some("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
        );
        assert_eq!(rows[1].status, SubmoduleStatus::Dirty);
        assert_eq!(rows[1].recorded, "9f0e1aa9f0e1aa9f0e1aa9f0e1aa9f0e1aa9f0e1");
        assert_eq!(
            rows[1].checked_out.as_deref(),
            Some("c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7a8b9c4d5")
        );
        assert_eq!(rows[1].url, "git@example.com:sample/theme.git");
        assert_eq!(rows[1].branch.as_deref(), Some("main"));
        assert_eq!(rows[2].status, SubmoduleStatus::Uninitialized);
        assert_eq!(rows[2].checked_out, None);
        assert_eq!(rows[2].recorded, "11223344556677889900aabbccddeeff00112233");
        assert_eq!(rows[3].status, SubmoduleStatus::UpdateFailed);
    }

    #[test]
    fn rejects_a_status_line_without_a_sha() {
        assert!(parse_status(" vendor/core\n").is_err());
    }
}
