use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use rusqlite_migration::Migrations;

use crate::error::CoreError;

pub(crate) const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const PAGE_LIMIT_MAX: u32 = 200;
const SIDECARS: [&str; 2] = ["-wal", "-shm"];

pub(crate) struct Database {
    pub file: &'static str,
    pub migrations: fn() -> Migrations<'static>,
}

pub(crate) fn failure(path: &Path, detail: impl ToString) -> CoreError {
    CoreError::StorageFailed {
        path: path.display().to_string(),
        detail: detail.to_string(),
    }
}

pub(crate) fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_secs()).ok())
        .unwrap_or_default()
}

pub(crate) fn page_limit(limit: u32) -> i64 {
    i64::from(limit.clamp(1, PAGE_LIMIT_MAX))
}

pub(crate) fn page_cursor(before: Option<u32>) -> i64 {
    before.map_or(i64::MAX, i64::from)
}

impl Database {
    pub(crate) fn path(&self, dir: &Path) -> PathBuf {
        dir.join(self.file)
    }

    pub(crate) fn connect(&self, dir: &Path, busy: Duration) -> Result<Connection, CoreError> {
        let path = self.path(dir);
        fs::create_dir_all(dir).map_err(|error| failure(dir, error))?;
        let conn = Connection::open(&path).map_err(|error| failure(&path, error))?;
        conn.busy_timeout(busy)
            .and_then(|()| conn.pragma_update(None, "journal_mode", "WAL"))
            .and_then(|()| conn.pragma_update(None, "synchronous", "NORMAL"))
            .and_then(|()| conn.pragma_update(None, "foreign_keys", true))
            .map_err(|error| failure(&path, error))?;
        Ok(conn)
    }

    pub(crate) fn open(&self, dir: &Path) -> Result<Connection, CoreError> {
        let mut conn = self.connect(dir, BUSY_TIMEOUT)?;
        (self.migrations)()
            .to_latest(&mut conn)
            .map_err(|error| failure(&self.path(dir), error))?;
        Ok(conn)
    }

    pub(crate) fn check_integrity(&self, dir: &Path) -> Result<(), CoreError> {
        let path = self.path(dir);
        if !path.exists() {
            return Ok(());
        }
        let conn = self.connect(dir, BUSY_TIMEOUT)?;
        let verdict: String = conn
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|error| failure(&path, error))?;
        if verdict == "ok" {
            Ok(())
        } else {
            Err(failure(&path, format!("integrity check failed: {verdict}")))
        }
    }

    pub(crate) fn prepare(&self, dir: &Path) -> Result<(), CoreError> {
        let path = self.path(dir);
        if !path.exists() {
            return self.open(dir).map(drop);
        }
        self.check_integrity(dir)?;
        let conn = self.connect(dir, BUSY_TIMEOUT)?;
        let pending = (self.migrations)()
            .pending_migrations(&conn)
            .map_err(|error| failure(&path, error))?;
        if pending <= 0 {
            return self.open(dir).map(drop);
        }
        let copy = dir.join(format!("{}.pre-migration", self.file));
        if copy.exists() {
            fs::remove_file(&copy).map_err(|error| failure(&copy, error))?;
        }
        conn.execute("VACUUM INTO ?1", [copy.to_string_lossy().as_ref()])
            .map_err(|error| failure(&copy, error))?;
        drop(conn);
        self.open(dir)?;
        fs::remove_file(&copy).map_err(|error| failure(&copy, error))
    }

    pub(crate) fn move_aside(&self, dir: &Path) -> Result<PathBuf, CoreError> {
        let path = self.path(dir);
        let stamp = unix_now();
        let aside = dir.join(format!("{}.corrupt-{stamp}", self.file));
        fs::rename(&path, &aside).map_err(|error| failure(&path, error))?;
        for suffix in SIDECARS {
            let sidecar = dir.join(format!("{}{suffix}", self.file));
            match fs::rename(
                &sidecar,
                dir.join(format!("{}.corrupt-{stamp}{suffix}", self.file)),
            ) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(failure(&sidecar, error))
                }
                _ => {}
            }
        }
        Ok(aside)
    }
}

pub(crate) fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), CoreError> {
    if !path.is_absolute() {
        return Err(CoreError::invalid_request(
            "the export path must be absolute",
        ));
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| failure(path, error))?;
    fs::write(path, text).map_err(|error| failure(path, error))
}
