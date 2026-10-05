use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};
use yforge_core::{file_editable, load_settings, repo_snapshot, ErrorKind, ErrorPayload};

use crate::DataDir;

const MAX_FRAME: usize = 8 * 1024 * 1024;
const MAX_SESSIONS: usize = 8;
const MESSAGE_EVENT: &str = "lsp-message";
const ERROR_EVENT: &str = "lsp-error";

#[derive(Clone, Serialize)]
pub struct LspEvent {
    pub id: String,
    pub body: String,
}

#[derive(Serialize)]
pub struct Started {
    pub id: String,
    pub root_uri: String,
    pub file_uri: String,
    pub language_id: String,
}

struct Process {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    stopped: Arc<AtomicBool>,
    reader: Option<thread::JoinHandle<()>>,
}

impl Drop for Process {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Process>>);

fn invalid(message: impl Into<String>) -> ErrorPayload {
    ErrorPayload {
        kind: ErrorKind::InvalidRequest,
        message: message.into(),
        output: None,
    }
}

fn read_frame(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut length = None;
    let mut header_size = 0;
    loop {
        let mut line = String::new();
        let count = reader.read_line(&mut line)?;
        if count == 0 && header_size == 0 {
            return Ok(None);
        }
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "incomplete LSP header",
            ));
        }
        header_size += count;
        if header_size > 8192 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "LSP header is too large",
            ));
        }
        if line.trim().is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("content-length") {
                if length.is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "duplicate LSP length",
                    ));
                }
                length = Some(value.trim().parse::<usize>().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidData, "invalid LSP length")
                })?);
            }
        }
    }
    let size =
        length.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing LSP length"))?;
    if size > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "LSP message is too large",
        ));
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid LSP UTF-8"))
}

fn language_id(extension: &str) -> &str {
    match extension {
        "rs" => "rust",
        "ts" => "typescript",
        "tsx" => "typescriptreact",
        "js" => "javascript",
        "jsx" => "javascriptreact",
        "py" => "python",
        "md" => "markdown",
        "yml" => "yaml",
        extension => extension,
    }
}

#[tauri::command]
pub async fn lsp_start<R: Runtime>(
    app: AppHandle<R>,
    sessions: State<'_, Sessions>,
    path: String,
    file: String,
) -> Result<Started, ErrorPayload> {
    let extension = std::path::Path::new(&file)
        .extension()
        .and_then(|part| part.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let command = load_settings(&app.state::<DataDir>().0)?
        .language_servers
        .get(&extension)
        .cloned()
        .ok_or_else(|| invalid(format!("No language server is configured for .{extension}")))?;
    let parts = shlex::split(&command)
        .filter(|parts| !parts.is_empty())
        .ok_or_else(|| invalid("The language server command has invalid quoting"))?;
    let snapshot = repo_snapshot(std::path::Path::new(&path))?;
    file_editable(std::path::Path::new(&path), &file)?;
    let root = std::path::Path::new(&snapshot.root)
        .canonicalize()
        .map_err(|error| ErrorPayload::internal(error.to_string()))?;
    let root_uri = Url::from_directory_path(&root)
        .map_err(|_| invalid("The repository path is not a file URL"))?
        .to_string();
    let file_uri = Url::from_file_path(root.join(&file))
        .map_err(|_| invalid("The file path is not a file URL"))?
        .to_string();
    let program = parts
        .first()
        .ok_or_else(|| invalid("Enter an installed language server command"))?;
    let mut active = sessions.0.lock().unwrap_or_else(PoisonError::into_inner);
    if active.len() >= MAX_SESSIONS {
        return Err(invalid(
            "Close a language server before starting another one",
        ));
    }
    let mut child = Command::new(program)
        .args(&parts[1..])
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            ErrorPayload::internal(format!("Could not start the language server: {error}"))
        })?;
    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| {
        ErrorPayload::internal("Language server stdin unavailable")
    })?));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ErrorPayload::internal("Language server stdout unavailable"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let stopped = Arc::new(AtomicBool::new(false));
    let signal = Arc::clone(&stopped);
    let target = id.clone();
    let reader = thread::spawn(move || {
        let mut output = BufReader::new(stdout);
        loop {
            match read_frame(&mut output) {
                Ok(Some(body)) => {
                    if serde_json::from_str::<serde_json::Value>(&body).is_err() {
                        if !signal.load(Ordering::Acquire) {
                            let _ = app.emit(
                                ERROR_EVENT,
                                LspEvent {
                                    id: target.clone(),
                                    body: "The language server sent invalid JSON".into(),
                                },
                            );
                        }
                        break;
                    }
                    if app
                        .emit(
                            MESSAGE_EVENT,
                            LspEvent {
                                id: target.clone(),
                                body,
                            },
                        )
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(None) => {
                    if !signal.load(Ordering::Acquire) {
                        let _ = app.emit(
                            ERROR_EVENT,
                            LspEvent {
                                id: target.clone(),
                                body: "The language server exited".into(),
                            },
                        );
                    }
                    break;
                }
                Err(error) => {
                    if !signal.load(Ordering::Acquire) {
                        let _ = app.emit(
                            ERROR_EVENT,
                            LspEvent {
                                id: target.clone(),
                                body: format!("Language server communication failed: {error}"),
                            },
                        );
                    }
                    break;
                }
            }
        }
    });
    active.insert(
        id.clone(),
        Process {
            child,
            stdin,
            stopped,
            reader: Some(reader),
        },
    );
    Ok(Started {
        id,
        root_uri,
        file_uri,
        language_id: language_id(&extension).to_owned(),
    })
}

#[tauri::command]
pub async fn lsp_send(
    sessions: State<'_, Sessions>,
    id: String,
    body: String,
) -> Result<(), ErrorPayload> {
    if body.len() > MAX_FRAME || serde_json::from_str::<serde_json::Value>(&body).is_err() {
        return Err(invalid("Invalid language server message"));
    }
    let stdin = sessions
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&id)
        .map(|process| Arc::clone(&process.stdin))
        .ok_or_else(|| invalid("Language server is not running"))?;
    let mut writer = stdin.lock().unwrap_or_else(PoisonError::into_inner);
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())
        .and_then(|()| writer.write_all(body.as_bytes()))
        .and_then(|()| writer.flush())
        .map_err(|error| {
            ErrorPayload::internal(format!("Could not send to language server: {error}"))
        })
}

#[tauri::command]
pub async fn lsp_stop(sessions: State<'_, Sessions>, id: String) -> Result<(), ErrorPayload> {
    let process = sessions
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&id)
        .ok_or_else(|| invalid("Language server is not running"))?;
    drop(process);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_bounded_lsp_frame_and_refuses_malformed_lengths() {
        let mut valid = BufReader::new(&b"Content-Length: 13\r\n\r\n{\"jsonrpc\":2}"[..]);
        assert_eq!(
            read_frame(&mut valid).unwrap(),
            Some("{\"jsonrpc\":2}".into())
        );
        let input = format!("Content-Length: {}\r\n\r\n", MAX_FRAME + 1).into_bytes();
        let mut oversized = BufReader::new(input.as_slice());
        assert_eq!(
            read_frame(&mut oversized).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
}
