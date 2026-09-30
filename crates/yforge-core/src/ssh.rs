use std::fs;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::CoreError;
use crate::sqlite::failure;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SshKey {
    pub path: String,
    pub name: String,
    pub algorithm: String,
}

pub fn list_ssh_keys(ssh_dir: &Path) -> Result<Vec<SshKey>, CoreError> {
    let entries = match fs::read_dir(ssh_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(failure(ssh_dir, error)),
    };
    let mut keys = Vec::new();
    for entry in entries {
        let path = entry.map_err(|error| failure(ssh_dir, error))?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.ends_with(".pub") || !path.is_file() {
            continue;
        }
        let Ok(public) = fs::read_to_string(ssh_dir.join(format!("{name}.pub"))) else {
            continue;
        };
        let Some(algorithm) = public.split_whitespace().next() else {
            continue;
        };
        keys.push(SshKey {
            path: path.display().to_string(),
            name: name.to_owned(),
            algorithm: algorithm.to_owned(),
        });
    }
    keys.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(keys)
}
