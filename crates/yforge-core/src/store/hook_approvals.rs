use std::path::Path;

use rusqlite::{params, OptionalExtension};

use super::{open, sql};
use crate::error::CoreError;
use crate::sqlite::unix_now;

pub(crate) fn approved_hook_hash(
    dir: &Path,
    repository: &str,
    hook: &str,
) -> Result<Option<String>, CoreError> {
    open(dir)?
        .query_row(
            "SELECT hash FROM hook_approvals WHERE repository = ?1 AND hook = ?2",
            params![repository, hook],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql(dir))
}

pub(crate) fn approve_hook_hash(
    dir: &Path,
    repository: &str,
    hook: &str,
    hash: &str,
) -> Result<(), CoreError> {
    open(dir)?
        .execute(
            "INSERT INTO hook_approvals (repository, hook, hash, approved_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (repository, hook) DO UPDATE SET hash = excluded.hash, approved_at = excluded.approved_at",
            params![repository, hook, hash, unix_now()],
        )
        .map(drop)
        .map_err(sql(dir))
}
