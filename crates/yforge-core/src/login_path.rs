use std::env;
use std::ffi::{OsStr, OsString};
use std::io::{self, Read};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const MARKER: &str = "__YFORGE_LOGIN_PATH__";
const TIMEOUT: Duration = Duration::from_secs(5);

pub fn adopt_login_shell_path() -> io::Result<()> {
    let shell = env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .ok_or_else(|| io::Error::other("SHELL is not set"))?;
    let login = login_shell_path(Path::new(&shell), TIMEOUT)?;
    let current = env::var_os("PATH").unwrap_or_default();
    env::set_var("PATH", merged(&login, &current)?);
    Ok(())
}

fn login_shell_path(shell: &Path, timeout: Duration) -> io::Result<OsString> {
    let mut child = Command::new(shell)
        .arg("-ilc")
        .arg(format!("printf '{MARKER}%s{MARKER}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut output = Vec::new();
        let read = stdout.read_to_end(&mut output).map(|_| output);
        sender.send(read).ok();
    });
    let Ok(output) = receiver.recv_timeout(timeout) else {
        child.kill().ok();
        child.wait()?;
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("{} did not report PATH within {timeout:?}", shell.display()),
        ));
    };
    let output = output?;
    let status = child.wait()?;
    if !status.success() {
        return Err(io::Error::other(format!(
            "{} exited with {status}",
            shell.display()
        )));
    }
    let marker = MARKER.as_bytes();
    let start = output
        .windows(marker.len())
        .position(|window| window == marker)
        .map(|index| index + marker.len());
    let path = start.and_then(|start| {
        output[start..]
            .windows(marker.len())
            .position(|window| window == marker)
            .map(|end| &output[start..start + end])
    });
    match path {
        Some(path) if !path.is_empty() => Ok(OsStr::from_bytes(path).to_owned()),
        _ => Err(io::Error::other(format!(
            "{} did not report PATH",
            shell.display()
        ))),
    }
}

fn merged(login: &OsStr, current: &OsStr) -> io::Result<OsString> {
    let mut entries: Vec<PathBuf> = Vec::new();
    for entry in env::split_paths(login).chain(env::split_paths(current)) {
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    env::join_paths(entries).map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Instant;

    fn shell(dir: &Path, script: &str) -> PathBuf {
        let path = dir.join("shell");
        fs::write(&path, script).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn merging_puts_login_entries_first_and_keeps_launcher_only_entries_once() {
        assert_eq!(
            merged(
                OsStr::new("/login/bin:/usr/bin"),
                OsStr::new("/usr/bin:/bin")
            )
            .unwrap(),
            OsString::from("/login/bin:/usr/bin:/bin")
        );
    }

    #[test]
    fn a_failing_shell_reports_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let failing = shell(dir.path(), "#!/bin/sh\nexit 3\n");
        assert!(login_shell_path(&failing, TIMEOUT).is_err());
    }

    #[test]
    fn a_hanging_shell_is_stopped_at_the_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let hanging = shell(dir.path(), "#!/bin/sh\nexec sleep 30\n");
        let started = Instant::now();
        let error = login_shell_path(&hanging, Duration::from_millis(200)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
