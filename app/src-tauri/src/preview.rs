use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::State;
use uuid::Uuid;
use yforge_core::{preview_file_bytes, ErrorKind, ErrorPayload};

struct Session {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}

#[derive(Default)]
pub struct PreviewServers(Mutex<HashMap<String, Session>>);

fn invalid(reason: &str) -> ErrorPayload {
    ErrorPayload {
        kind: ErrorKind::InvalidRequest,
        message: reason.to_owned(),
        output: None,
    }
}

fn mime(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "css" => Some("text/css; charset=utf-8"),
        "js" | "mjs" => Some("text/javascript; charset=utf-8"),
        "json" => Some("application/json"),
        "md" | "markdown" => Some("text/markdown; charset=utf-8"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        _ => None,
    }
}

fn requested_file(request: &str, token: &str) -> Option<String> {
    let (method, target) = request.split_once(' ')?;
    if method != "GET" {
        return None;
    }
    let (path, version) = target.split_once(' ')?;
    if !version.starts_with("HTTP/1.") {
        return None;
    }
    let path = path.split(['?', '#']).next()?;
    let rest = path
        .strip_prefix('/')?
        .strip_prefix(token)?
        .strip_prefix('/')?;
    let decoded = percent_decode_str(rest).decode_utf8().ok()?;
    if decoded.is_empty()
        || decoded.contains('%')
        || decoded.contains('\\')
        || !Path::new(decoded.as_ref())
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(decoded.into_owned())
}

fn response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    port: u16,
) -> std::io::Result<()> {
    let origin = format!("http://127.0.0.1:{port}");
    let csp = format!("default-src 'none'; script-src {origin} 'unsafe-inline'; style-src {origin} 'unsafe-inline'; img-src {origin} data:; font-src {origin} data:; connect-src {origin}; media-src {origin}; object-src 'none'; frame-src 'none'; worker-src 'none'; prefetch-src 'none'; base-uri 'none'; form-action 'none'; navigate-to {origin}; sandbox allow-scripts");
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nContent-Security-Policy: {csp}\r\nAccess-Control-Allow-Origin: null\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(body)
}

fn serve(
    mut stream: TcpStream,
    path: &Path,
    rev: &str,
    token: &str,
    port: u16,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let mut request = String::new();
    BufReader::new((&mut stream).take(4096)).read_line(&mut request)?;
    let file = requested_file(request.trim_end_matches(['\r', '\n']), token);
    let data = file.as_deref().and_then(mime).and_then(|kind| {
        preview_file_bytes(path, file.as_deref()?, rev)
            .ok()
            .map(|bytes| (kind, bytes))
    });
    match data {
        Some((kind, bytes)) => response(&mut stream, "200 OK", kind, &bytes, port),
        None => response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
            port,
        ),
    }
}

fn stop(session: Session) {
    session.stop.store(true, Ordering::Release);
    let _ = TcpStream::connect_timeout(&session.addr, Duration::from_secs(1));
    let _ = session.worker.join();
}

impl Drop for PreviewServers {
    fn drop(&mut self) {
        for (_, session) in self.0.get_mut().unwrap().drain() {
            stop(session);
        }
    }
}

impl PreviewServers {
    pub fn is_active(&self) -> bool {
        !self.0.lock().unwrap().is_empty()
    }

    pub fn allows_navigation(&self, url: &tauri::Url) -> bool {
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
            return false;
        }
        self.0.lock().unwrap().iter().any(|(token, session)| {
            Some(session.addr.port()) == url.port() && url.path().starts_with(&format!("/{token}/"))
        })
    }

    pub fn navigation_allowed(&self, url: &tauri::Url) -> bool {
        !self.is_active() || url.scheme() == "about" || self.allows_navigation(url)
    }
}

#[tauri::command]
pub async fn preview_start(
    path: String,
    file: String,
    rev: String,
    servers: State<'_, PreviewServers>,
) -> Result<(String, String), ErrorPayload> {
    if mime(&file).is_none() {
        return Err(invalid("Unsupported preview file type"));
    }
    preview_file_bytes(Path::new(&path), &file, &rev).map_err(ErrorPayload::from)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| invalid(&error.to_string()))?;
    let addr = listener
        .local_addr()
        .map_err(|error| invalid(&error.to_string()))?;
    let token = Uuid::new_v4().to_string();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let running = stop_flag.clone();
    let repo = PathBuf::from(path);
    let revision = rev;
    let credential = token.clone();
    let worker = thread::spawn(move || {
        for stream in listener.incoming() {
            if running.load(Ordering::Acquire) {
                break;
            }
            match stream {
                Ok(stream) => {
                    let _ = serve(stream, &repo, &revision, &credential, addr.port());
                }
                Err(_) => break,
            }
        }
    });
    let url = format!(
        "http://{addr}/{token}/{}",
        file.split('/')
            .map(|part| utf8_percent_encode(part, NON_ALPHANUMERIC).to_string())
            .collect::<Vec<_>>()
            .join("/")
    );
    servers.0.lock().unwrap().insert(
        token.clone(),
        Session {
            addr,
            stop: stop_flag,
            worker,
        },
    );
    Ok((token, url))
}

#[tauri::command]
pub async fn preview_stop(
    id: String,
    servers: State<'_, PreviewServers>,
) -> Result<(), ErrorPayload> {
    let session = servers
        .0
        .lock()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| invalid("Preview is not running"))?;
    stop(session);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_token_scoped_safe_paths_and_supported_assets() {
        assert_eq!(
            requested_file("GET /secret/assets/a%20b.css HTTP/1.1", "secret"),
            Some("assets/a b.css".to_owned())
        );
        for request in [
            "GET /bad/assets/a.css HTTP/1.1",
            "GET /secret/../outside.css HTTP/1.1",
            "GET /secret/%2e%2e/outside.css HTTP/1.1",
            "GET /secret/a%252f.css HTTP/1.1",
            "GET /secret/a%5c.css HTTP/1.1",
            "POST /secret/a.css HTTP/1.1",
        ] {
            assert_eq!(requested_file(request, "secret"), None, "{request}");
        }
        assert_eq!(mime("a.exe"), None);
        assert_eq!(mime("index.html"), Some("text/html; charset=utf-8"));
    }

    #[test]
    fn active_preview_blocks_app_origin_and_external_navigations_from_its_frame() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let running = Arc::new(AtomicBool::new(false));
        let worker = thread::spawn(move || {
            let _ = listener.accept();
        });
        let servers = PreviewServers::default();
        servers.0.lock().unwrap().insert(
            "secret".into(),
            Session {
                addr,
                stop: running,
                worker,
            },
        );

        assert!(servers.navigation_allowed(
            &format!("http://127.0.0.1:{}/secret/page.html", addr.port())
                .parse()
                .unwrap()
        ));
        assert!(servers.navigation_allowed(&"about:blank".parse().unwrap()));
        assert!(!servers.navigation_allowed(&"tauri://localhost/".parse().unwrap()));
        assert!(!servers.navigation_allowed(&"http://localhost:1420/".parse().unwrap()));
        assert!(!servers.navigation_allowed(&"https://example.test/collect".parse().unwrap()));
    }
}
