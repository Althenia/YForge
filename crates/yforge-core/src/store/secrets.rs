use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use super::{open, state_path, STATE};
use crate::error::CoreError;
use crate::secrets::{LegacyKeychain, Namespace};
use crate::sqlite::{failure, unix_now, BUSY_TIMEOUT};

const PENDING: &str = "secrets.keychain_pending";

fn sql(dir: &Path, operation: &str, error: rusqlite::Error) -> CoreError {
    let cause = match error {
        rusqlite::Error::SqliteFailure(code, _) => format!("SQLite code {}", code.extended_code),
        _ => "unexpected database result".to_owned(),
    };
    failure(&state_path(dir), format!("{operation}: {cause}"))
}

pub(super) fn mark_upgrade(dir: &Path) -> Result<(), CoreError> {
    if !state_path(dir).exists() {
        return Ok(());
    }
    STATE.check_integrity(dir)?;
    let conn = STATE.connect(dir, BUSY_TIMEOUT)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| sql(dir, "read schema version", error))?;
    if (1..17).contains(&version) {
        conn.pragma_update(None, "synchronous", "FULL")
            .and_then(|()| {
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, 'true')",
                    [PENDING],
                )
                .map(drop)
            })
            .map_err(|error| sql(dir, "mark legacy credentials for migration", error))?;
    }
    Ok(())
}

fn read(
    conn: &Connection,
    namespace: Namespace,
    account: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM secrets WHERE namespace = ?1 AND account = ?2",
        [namespace.key(), account],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn get(
    dir: &Path,
    namespace: Namespace,
    account: &str,
) -> Result<Option<String>, CoreError> {
    read(&open(dir)?, namespace, account).map_err(|error| sql(dir, "read saved credential", error))
}

pub(crate) fn set(
    dir: &Path,
    namespace: Namespace,
    account: &str,
    value: &str,
) -> Result<(), CoreError> {
    let conn = open(dir)?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|error| sql(dir, "make credential write durable", error))?;
    conn
        .execute(
            "INSERT INTO secrets (namespace, account, value, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (namespace, account) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![namespace.key(), account, value, unix_now()],
        )
        .map(drop)
        .map_err(|error| sql(dir, "save credential", error))
}

pub(crate) fn delete(dir: &Path, namespace: Namespace, account: &str) -> Result<(), CoreError> {
    let conn = open(dir)?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|error| sql(dir, "make credential deletion durable", error))?;
    conn.execute(
        "DELETE FROM secrets WHERE namespace = ?1 AND account = ?2",
        [namespace.key(), account],
    )
    .map(drop)
    .map_err(|error| sql(dir, "delete saved credential", error))
}

fn pending(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?1)",
        [PENDING],
        |row| row.get(0),
    )
}

fn cleanup(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    conn.prepare("SELECT service, account FROM secret_cleanup ORDER BY service, account")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

fn item_error(dir: &Path, service: &str, account: &str, detail: &str) -> CoreError {
    failure(
        &state_path(dir),
        format!("credential migration for {service} / {account}: {detail}"),
    )
}

fn source_error(dir: &Path, service: &str, account: &str, error: CoreError) -> CoreError {
    item_error(dir, service, account, &error.to_string())
}

pub(crate) fn migrate(dir: &Path, legacy: Option<&dyn LegacyKeychain>) -> Result<(), CoreError> {
    let conn = open(dir)?;
    let copy =
        pending(&conn).map_err(|error| sql(dir, "read credential migration state", error))?;
    let waiting = cleanup(&conn).map_err(|error| sql(dir, "read credential cleanup", error))?;
    if !copy && waiting.is_empty() {
        return Ok(());
    }
    let legacy = legacy.ok_or_else(|| {
        failure(
            &state_path(dir),
            "legacy credentials are not moved or cleaned up in this data folder because native Keychain migration is disabled",
        )
    })?;
    drop(conn);
    if copy {
        copy_legacy(dir, legacy)?;
    }
    cleanup_legacy(dir, legacy)
}

fn copy_legacy(dir: &Path, legacy: &dyn LegacyKeychain) -> Result<(), CoreError> {
    let mut values = Vec::new();
    for namespace in [Namespace::Ai, Namespace::SshPassphrase] {
        let service = namespace.service();
        let mut accounts = legacy
            .accounts(service)
            .map_err(|error| source_error(dir, service, "enumeration", error))?;
        accounts.sort();
        accounts.dedup();
        for account in accounts {
            if let Some(value) = legacy
                .read(service, &account)
                .map_err(|error| source_error(dir, service, &account, error))?
            {
                values.push((namespace, account, value));
            }
        }
    }

    let mut conn = open(dir)?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|error| sql(dir, "make credential copy durable", error))?;
    let tx = conn
        .transaction()
        .map_err(|error| sql(dir, "begin credential copy", error))?;
    for (namespace, account, value) in &values {
        match read(&tx, *namespace, account)
            .map_err(|error| sql(dir, "check credential destination", error))?
        {
            Some(existing) if existing != *value => {
                return Err(item_error(
                    dir,
                    namespace.service(),
                    account,
                    "the destination contains a different value; both copies were kept",
                ));
            }
            Some(_) => {}
            None => {
                tx.execute(
                    "INSERT INTO secrets (namespace, account, value, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    params![namespace.key(), account, value, unix_now()],
                ).map_err(|error| sql(dir, "copy legacy credential", error))?;
            }
        }
        tx.execute(
            "INSERT OR IGNORE INTO secret_cleanup (service, account) VALUES (?1, ?2)",
            [namespace.service(), account],
        )
        .map_err(|error| sql(dir, "record credential cleanup", error))?;
    }
    tx.execute("DELETE FROM settings WHERE key = ?1", [PENDING])
        .map_err(|error| sql(dir, "finish credential copy", error))?;
    tx.commit()
        .map_err(|error| sql(dir, "commit credential copy", error))?;
    drop(conn);

    let verified = open(dir)?;
    for (namespace, account, value) in &values {
        if read(&verified, *namespace, account)
            .map_err(|error| sql(dir, "verify credential copy", error))?
            .as_ref()
            != Some(value)
        {
            return Err(item_error(
                dir,
                namespace.service(),
                account,
                "the committed destination failed verification; the source was kept",
            ));
        }
    }
    Ok(())
}

fn cleanup_legacy(dir: &Path, legacy: &dyn LegacyKeychain) -> Result<(), CoreError> {
    let conn = open(dir)?;
    let rows = cleanup(&conn).map_err(|error| sql(dir, "read credential cleanup", error))?;
    drop(conn);
    let mut failures = Vec::new();
    for (service, account) in rows {
        let result = (|| {
            let namespace = Namespace::from_service(&service).ok_or_else(|| {
                item_error(
                    dir,
                    &service,
                    &account,
                    "the service is not owned by YForge",
                )
            })?;
            let destination = get(dir, namespace, &account)?.ok_or_else(|| {
                item_error(
                    dir,
                    &service,
                    &account,
                    "the destination is missing; the source was kept",
                )
            })?;
            if let Some(source) = legacy
                .read(&service, &account)
                .map_err(|error| source_error(dir, &service, &account, error))?
            {
                if source != destination {
                    return Err(item_error(
                        dir,
                        &service,
                        &account,
                        "the source and destination differ; both copies were kept",
                    ));
                }
                legacy
                    .delete(&service, &account)
                    .map_err(|error| source_error(dir, &service, &account, error))?;
            }
            open(dir)?
                .execute(
                    "DELETE FROM secret_cleanup WHERE service = ?1 AND account = ?2",
                    [&service, &account],
                )
                .map_err(|error| sql(dir, "finish credential cleanup", error))?;
            Ok::<_, CoreError>(())
        })();
        if let Err(error) = result {
            failures.push(error.to_string());
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failure(&state_path(dir), failures.join("; ")))
    }
}
