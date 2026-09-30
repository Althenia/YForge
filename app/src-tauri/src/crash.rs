use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, TryLockError};

use yforge_core::{CrashOrigin, NewCrash, Redactor};

static REPOSITORIES: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn note_repository(path: &str) {
    let mut known = REPOSITORIES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !known.iter().any(|known| known == path) {
        known.push(path.to_owned());
    }
}

pub fn seed_repositories(dir: &Path) {
    match yforge_core::load_recents(dir) {
        Ok(recents) => recents
            .iter()
            .for_each(|recent| note_repository(&recent.path)),
        Err(error) => log::warn!("could not read recents for crash redaction: {error}"),
    }
    match yforge_core::load_session(dir) {
        Ok(session) => session.tabs.iter().for_each(|tab| note_repository(tab)),
        Err(error) => log::warn!("could not read the session for crash redaction: {error}"),
    }
}

pub fn redactor() -> Redactor {
    let known = match REPOSITORIES.try_lock() {
        Ok(known) => known.clone(),
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner().clone(),
        Err(TryLockError::WouldBlock) => Vec::new(),
    };
    Redactor::from_environment(&known)
}

fn message(info: &PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    payload
        .downcast_ref::<&str>()
        .map(|text| (*text).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic with a non-text payload".to_owned())
}

fn record_panic(dir: &Path, info: &PanicHookInfo<'_>) {
    let crash = NewCrash {
        origin: CrashOrigin::Rust,
        kind: "panic".to_owned(),
        thread: std::thread::current().name().map(str::to_owned),
        message: message(info),
        location: info
            .location()
            .map(|at| format!("{}:{}:{}", at.file(), at.line(), at.column())),
        stack: Some(std::backtrace::Backtrace::force_capture().to_string()),
        view: None,
    };
    let redactor = redactor();
    if let Err(error) = yforge_core::record_panic(dir, env!("CARGO_PKG_VERSION"), &redactor, &crash)
    {
        let _ = writeln!(
            std::io::stderr(),
            "yforge: crash not recorded ({}): thread={} at {}: {}",
            redactor.redact(&error.to_string()),
            crash.thread.as_deref().unwrap_or("unnamed"),
            redactor.redact(crash.location.as_deref().unwrap_or("unknown")),
            redactor.redact(&crash.message),
        );
    }
}

pub fn install_panic_hook(dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record_panic(&dir, info);
        previous(info);
    }));
}
