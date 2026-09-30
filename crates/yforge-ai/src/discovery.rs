use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use yforge_core::CancelToken;

use crate::process::{run, Invocation};

#[derive(Debug, Clone)]
pub struct Environment {
    pub shell: Option<PathBuf>,
    pub known_dirs: Vec<PathBuf>,
}

impl Environment {
    pub fn system() -> Self {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let mut known_dirs: Vec<PathBuf> = home
            .iter()
            .map(|home| home.join(".local").join("bin"))
            .collect();
        known_dirs.push(PathBuf::from("/opt/homebrew/bin"));
        known_dirs.push(PathBuf::from("/usr/local/bin"));
        Self {
            shell: std::env::var_os("SHELL")
                .filter(|shell| !shell.is_empty())
                .map(PathBuf::from),
            known_dirs,
        }
    }
}

fn executable(path: &Path) -> bool {
    path.is_absolute()
        && std::fs::metadata(path)
            .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

async fn from_login_shell(shell: &Path, binary: &str, timeout: Duration) -> Option<PathBuf> {
    let invocation = Invocation {
        program: shell.to_owned(),
        args: vec!["-lc".to_owned(), format!("command -v {binary}")],
        ..Invocation::default()
    };
    let output = run(&invocation, timeout, None::<&CancelToken>, &|_| ())
        .await
        .ok()?;
    output
        .stdout
        .lines()
        .rev()
        .map(|line| PathBuf::from(line.trim()))
        .find(|candidate| executable(candidate))
}

pub async fn locate(
    environment: &Environment,
    binary: &str,
    explicit: Option<&str>,
    timeout: Duration,
) -> Result<PathBuf, String> {
    if let Some(explicit) = explicit.map(str::trim).filter(|path| !path.is_empty()) {
        let path = PathBuf::from(explicit);
        return if executable(&path) {
            Ok(path)
        } else {
            Err(format!("{explicit} is not an executable file"))
        };
    }
    if let Some(shell) = &environment.shell {
        if let Some(found) = from_login_shell(shell, binary, timeout).await {
            return Ok(found);
        }
    }
    environment
        .known_dirs
        .iter()
        .map(|dir| dir.join(binary))
        .find(|candidate| executable(candidate))
        .ok_or_else(|| format!("the `{binary}` command was not found"))
}
