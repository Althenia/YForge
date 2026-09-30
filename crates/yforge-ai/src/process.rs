use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::Command;
use yforge_core::CancelToken;

const OUTPUT_CAP: usize = 4 * 1024 * 1024;
const CANCEL_POLL: Duration = Duration::from_millis(50);

#[derive(Debug, Default, Clone)]
pub struct Invocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub stdin: Option<String>,
    pub path_prefix: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct Output {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub enum RunFailure {
    Spawn(std::io::Error),
    Timeout,
    Cancelled,
}

async fn cancelled(cancel: Option<&CancelToken>) {
    match cancel {
        Some(token) => {
            while !token.is_cancelled() {
                tokio::time::sleep(CANCEL_POLL).await;
            }
        }
        None => std::future::pending().await,
    }
}

async fn read_lines<R: AsyncRead + Unpin>(
    reader: Option<R>,
    mut on_line: impl FnMut(&str),
) -> String {
    let Some(reader) = reader else {
        return String::new();
    };
    let mut reader = BufReader::new(reader);
    let mut text = String::new();
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer).await {
            Ok(0) | Err(_) => return text,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buffer);
                on_line(line.trim_end_matches(['\n', '\r']));
                if text.len() < OUTPUT_CAP {
                    text.push_str(&line);
                }
            }
        }
    }
}

async fn drive(
    invocation: &Invocation,
    on_line: &(dyn Fn(&str) + Send + Sync),
) -> std::io::Result<Output> {
    let mut command = Command::new(&invocation.program);
    command
        .args(&invocation.args)
        .stdin(if invocation.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &invocation.cwd {
        command.current_dir(cwd);
    }
    if let Some(prefix) = &invocation.path_prefix {
        let mut paths = vec![prefix.clone()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        if let Ok(joined) = std::env::join_paths(paths) {
            command.env("PATH", joined);
        }
    }
    let mut child = command.spawn()?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let write = async {
        if let (Some(mut stdin), Some(text)) = (stdin, &invocation.stdin) {
            let _ = stdin.write_all(text.as_bytes()).await;
            let _ = stdin.shutdown().await;
        }
    };
    let (_, stdout, stderr, status) = tokio::join!(
        write,
        read_lines(stdout, on_line),
        read_lines(stderr, on_line),
        child.wait()
    );
    Ok(Output {
        status: status?.code(),
        stdout,
        stderr,
    })
}

pub async fn run(
    invocation: &Invocation,
    timeout: Duration,
    cancel: Option<&CancelToken>,
    on_line: &(dyn Fn(&str) + Send + Sync),
) -> Result<Output, RunFailure> {
    tokio::select! {
        biased;
        () = cancelled(cancel) => Err(RunFailure::Cancelled),
        () = tokio::time::sleep(timeout) => Err(RunFailure::Timeout),
        result = drive(invocation, on_line) => result.map_err(RunFailure::Spawn),
    }
}
