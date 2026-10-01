use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Row};

use super::{load_repo_settings, load_settings, open, sql};
use crate::error::CoreError;
use crate::git_hosts::{valid_draft, GitHost, GitHostDraft, SshPlan};
use crate::sqlite::unix_now;
use crate::ssh::{key_details, public_path};

const COLUMNS: &str = "id, host, ssh_key_path, https_user";

fn read_row(row: &Row<'_>) -> rusqlite::Result<GitHost> {
    Ok(GitHost {
        id: row.get(0)?,
        host: row.get(1)?,
        ssh_key_path: row.get(2)?,
        https_user: row.get(3)?,
        ..GitHost::default()
    })
}

fn with_key_details(mut host: GitHost) -> GitHost {
    if let Some(path) = host.ssh_key_path.as_deref().map(Path::new) {
        host.has_public_key = public_path(path).is_file();
        if let Some((kind, fingerprint)) = key_details(path) {
            host.key_kind = Some(kind);
            host.key_fingerprint = Some(fingerprint);
        }
    }
    host
}

fn stored_hosts(dir: &Path) -> Result<Vec<GitHost>, CoreError> {
    open(dir)?
        .prepare(&format!("SELECT {COLUMNS} FROM git_hosts ORDER BY seq"))
        .and_then(|mut statement| {
            statement
                .query_map([], read_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))
}

fn fresh_id(conn: &Connection) -> rusqlite::Result<String> {
    let mut stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    loop {
        let id = format!("git-host-{stamp:x}");
        let taken: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM git_hosts WHERE id = ?1)",
            [&id],
            |row| row.get(0),
        )?;
        if !taken {
            return Ok(id);
        }
        stamp += 1;
    }
}

fn require_free(
    conn: &Connection,
    dir: &Path,
    host: &str,
    except: Option<&str>,
) -> Result<(), CoreError> {
    let taken: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM git_hosts WHERE host = ?1 AND id IS NOT ?2)",
            params![host, except],
            |row| row.get(0),
        )
        .map_err(sql(dir))?;
    if taken {
        return Err(CoreError::invalid_request(format!(
            "there is already an identity for {host}; edit that one instead"
        )));
    }
    Ok(())
}

fn missing(id: &str) -> CoreError {
    CoreError::invalid_request(format!("there is no host identity `{id}`"))
}

pub fn git_hosts_list(dir: &Path) -> Result<Vec<GitHost>, CoreError> {
    Ok(stored_hosts(dir)?
        .into_iter()
        .map(with_key_details)
        .collect())
}

pub fn git_host_add(dir: &Path, draft: &GitHostDraft) -> Result<GitHost, CoreError> {
    let draft = valid_draft(draft)?;
    let conn = open(dir)?;
    require_free(&conn, dir, &draft.host, None)?;
    let id = fresh_id(&conn).map_err(sql(dir))?;
    conn.execute(
        "INSERT INTO git_hosts (id, host, ssh_key_path, https_user, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            draft.host,
            draft.ssh_key_path,
            draft.https_user,
            unix_now()
        ],
    )
    .map_err(sql(dir))?;
    Ok(with_key_details(GitHost {
        id,
        host: draft.host,
        ssh_key_path: draft.ssh_key_path,
        https_user: draft.https_user,
        ..GitHost::default()
    }))
}

pub fn git_host_update(dir: &Path, id: &str, draft: &GitHostDraft) -> Result<GitHost, CoreError> {
    let draft = valid_draft(draft)?;
    let conn = open(dir)?;
    require_free(&conn, dir, &draft.host, Some(id))?;
    let changed = conn
        .execute(
            "UPDATE git_hosts SET host = ?2, ssh_key_path = ?3, https_user = ?4 WHERE id = ?1",
            params![id, draft.host, draft.ssh_key_path, draft.https_user],
        )
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    Ok(with_key_details(GitHost {
        id: id.to_owned(),
        host: draft.host,
        ssh_key_path: draft.ssh_key_path,
        https_user: draft.https_user,
        ..GitHost::default()
    }))
}

pub fn git_host_remove(dir: &Path, id: &str) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute("DELETE FROM git_hosts WHERE id = ?1", [id])
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    Ok(())
}

pub fn ssh_plan(dir: &Path, repository: Option<&str>) -> Result<SshPlan, CoreError> {
    let repository_key = match repository {
        Some(repository) => load_repo_settings(dir, repository)?.ssh_key_path,
        None => None,
    };
    Ok(SshPlan {
        repository_key: repository_key.map(PathBuf::from),
        app_key: load_settings(dir)?.ssh_key_path.map(PathBuf::from),
        hosts: stored_hosts(dir)?,
    })
}
