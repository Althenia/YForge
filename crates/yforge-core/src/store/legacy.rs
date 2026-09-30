use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use rusqlite::{Connection, TransactionBehavior};
use serde::de::DeserializeOwned;

use super::{
    insert_recent, sql, write_repo_settings, write_session, write_settings, AppSettings,
    RecentRepo, RepoSettings, TabSession,
};
use crate::error::CoreError;
use crate::sqlite::failure;

const FILES: [&str; 4] = [
    "settings.json",
    "repositories.json",
    "recents.json",
    "session.json",
];

fn read<T: DeserializeOwned>(dir: &Path, name: &str) -> Result<Option<T>, CoreError> {
    let path = dir.join(name);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| failure(&path, error)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(failure(&path, error)),
    }
}

pub(super) fn import(conn: &mut Connection, dir: &Path) -> Result<(), CoreError> {
    if !FILES.iter().any(|name| dir.join(name).exists()) {
        return Ok(());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql(dir))?;
    let settings: Option<AppSettings> = read(dir, FILES[0])?;
    let repositories: Option<BTreeMap<String, RepoSettings>> = read(dir, FILES[1])?;
    let recents: Option<Vec<RecentRepo>> = read(dir, FILES[2])?;
    let session: Option<TabSession> = read(dir, FILES[3])?;
    let present = [
        settings.is_some(),
        repositories.is_some(),
        recents.is_some(),
        session.is_some(),
    ];
    if !present.contains(&true) {
        return Ok(());
    }
    let write = || -> rusqlite::Result<()> {
        if let Some(settings) = &settings {
            write_settings(&tx, settings)?;
        }
        if let Some(repositories) = &repositories {
            tx.execute("DELETE FROM repo_settings", [])?;
            for (repository, settings) in repositories {
                write_repo_settings(&tx, repository, settings)?;
            }
        }
        if let Some(recents) = &recents {
            tx.execute("DELETE FROM recents", [])?;
            for recent in recents.iter().rev() {
                insert_recent(&tx, recent)?;
            }
        }
        if let Some(session) = &session {
            write_session(&tx, session)?;
        }
        Ok(())
    };
    write().map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))?;
    for (name, imported) in FILES.iter().zip(present) {
        if imported {
            let path = dir.join(name);
            fs::remove_file(&path).map_err(|error| failure(&path, error))?;
        }
    }
    Ok(())
}
