use std::path::Path;
use std::sync::RwLock;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::session::read_session;
use super::{open, parse, put_setting, sql, stored_values, write_session, TabSession};
use crate::error::CoreError;

pub const DEFAULT_PROFILE: &str = "default";
const ACTIVE: &str = "profiles.active";
const NAME_LIMIT: usize = 40;

static ACTIVE_AUTHOR: RwLock<Option<(String, String)>> = RwLock::new(None);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub author_name: String,
    pub author_email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ProfileList {
    pub active: String,
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProfileDraft {
    pub name: String,
    pub author_name: String,
    pub author_email: String,
}

pub(crate) fn active_author() -> Option<(String, String)> {
    ACTIVE_AUTHOR.read().ok().and_then(|author| author.clone())
}

fn publish_author(profile: &Profile) {
    if let Ok(mut author) = ACTIVE_AUTHOR.write() {
        *author = (!profile.author_name.is_empty() && !profile.author_email.is_empty())
            .then(|| (profile.author_name.clone(), profile.author_email.clone()));
    }
}

fn read_profiles(conn: &Connection) -> rusqlite::Result<Vec<Profile>> {
    conn.prepare("SELECT id, name, author_name, author_email FROM profiles ORDER BY position")?
        .query_map([], |row| {
            Ok(Profile {
                id: row.get(0)?,
                name: row.get(1)?,
                author_name: row.get(2)?,
                author_email: row.get(3)?,
            })
        })?
        .collect()
}

fn read_list(conn: &Connection, dir: &Path) -> Result<ProfileList, CoreError> {
    let stored = stored_values(conn, "SELECT key, value FROM settings", []).map_err(sql(dir))?;
    Ok(ProfileList {
        active: parse(dir, &stored, ACTIVE, DEFAULT_PROFILE.to_owned())?,
        profiles: read_profiles(conn).map_err(sql(dir))?,
    })
}

fn active_profile(list: &ProfileList) -> Result<&Profile, CoreError> {
    list.profiles
        .iter()
        .find(|profile| profile.id == list.active)
        .ok_or_else(|| CoreError::invalid_request("the active profile no longer exists"))
}

pub fn profiles_list(dir: &Path) -> Result<ProfileList, CoreError> {
    read_list(&open(dir)?, dir)
}

pub fn profile_activate(dir: &Path) -> Result<(), CoreError> {
    let list = profiles_list(dir)?;
    publish_author(active_profile(&list)?);
    Ok(())
}

fn validated(draft: &ProfileDraft, is_default: bool) -> Result<ProfileDraft, CoreError> {
    let name = draft.name.trim();
    if name.is_empty() || name.chars().count() > NAME_LIMIT {
        return Err(CoreError::invalid_request(format!(
            "a profile name must be 1 to {NAME_LIMIT} characters"
        )));
    }
    let author_name = draft.author_name.trim();
    let author_email = draft.author_email.trim();
    if is_default && author_name.is_empty() && author_email.is_empty() {
        return Ok(ProfileDraft {
            name: name.to_owned(),
            author_name: String::new(),
            author_email: String::new(),
        });
    }
    if author_name.is_empty() || author_name.contains(['<', '>', '\n']) {
        return Err(CoreError::invalid_request(
            "enter the author name for this profile, without < or >",
        ));
    }
    let email_ok = author_email
        .split_once('@')
        .is_some_and(|(local, domain)| !local.is_empty() && !domain.is_empty())
        && !author_email.contains(char::is_whitespace)
        && !author_email.contains(['<', '>']);
    if !email_ok {
        return Err(CoreError::invalid_request(
            "enter a valid author email for this profile",
        ));
    }
    Ok(ProfileDraft {
        name: name.to_owned(),
        author_name: author_name.to_owned(),
        author_email: author_email.to_owned(),
    })
}

fn require_unique_name(
    profiles: &[Profile],
    except: Option<&str>,
    name: &str,
) -> Result<(), CoreError> {
    let taken = profiles.iter().any(|profile| {
        Some(profile.id.as_str()) != except && profile.name.to_lowercase() == name.to_lowercase()
    });
    if taken {
        return Err(CoreError::invalid_request(format!(
            "a profile named {name} already exists"
        )));
    }
    Ok(())
}

pub fn profile_save(
    dir: &Path,
    id: Option<&str>,
    draft: &ProfileDraft,
) -> Result<Profile, CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    let list = read_list(&tx, dir)?;
    let saved = validated(draft, id == Some(DEFAULT_PROFILE))?;
    require_unique_name(&list.profiles, id, &saved.name)?;
    let profile = match id {
        None => {
            let next: i64 = tx
                .query_row(
                    "SELECT COALESCE(MAX(position), 0) + 1 FROM profiles",
                    [],
                    |row| row.get(0),
                )
                .map_err(sql(dir))?;
            let profile = Profile {
                id: format!("profile-{next}"),
                name: saved.name,
                author_name: saved.author_name,
                author_email: saved.author_email,
            };
            tx.execute(
                "INSERT INTO profiles (position, id, name, author_name, author_email) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![next, profile.id, profile.name, profile.author_name, profile.author_email],
            )
            .map_err(sql(dir))?;
            profile
        }
        Some(id) => {
            let changed = tx
                .execute(
                    "UPDATE profiles SET name = ?2, author_name = ?3, author_email = ?4 WHERE id = ?1",
                    params![id, saved.name, saved.author_name, saved.author_email],
                )
                .map_err(sql(dir))?;
            if changed == 0 {
                return Err(CoreError::invalid_request(format!(
                    "there is no profile {id}"
                )));
            }
            Profile {
                id: id.to_owned(),
                name: saved.name,
                author_name: saved.author_name,
                author_email: saved.author_email,
            }
        }
    };
    tx.commit().map_err(sql(dir))?;
    if list.active == profile.id {
        publish_author(&profile);
    }
    Ok(profile)
}

pub fn profile_delete(dir: &Path, id: &str) -> Result<(), CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    let list = read_list(&tx, dir)?;
    if id == DEFAULT_PROFILE {
        return Err(CoreError::invalid_request(
            "the Default profile cannot be deleted",
        ));
    }
    if id == list.active {
        return Err(CoreError::invalid_request(
            "switch to another profile before deleting the active one",
        ));
    }
    if list.profiles.len() <= 1 {
        return Err(CoreError::invalid_request(
            "the last profile cannot be deleted",
        ));
    }
    let removed = tx
        .execute("DELETE FROM profiles WHERE id = ?1", [id])
        .map_err(sql(dir))?;
    if removed == 0 {
        return Err(CoreError::invalid_request(format!(
            "there is no profile {id}"
        )));
    }
    tx.commit().map_err(sql(dir))
}

pub fn profile_switch(dir: &Path, id: &str) -> Result<(), CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    let list = read_list(&tx, dir)?;
    let target = list
        .profiles
        .iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| CoreError::invalid_request(format!("there is no profile {id}")))?
        .clone();
    if list.active != id {
        let current = read_session(&tx).map_err(sql(dir))?;
        let encoded = serde_json::to_string(&current)
            .map_err(|error| crate::sqlite::failure(&dir.join("yforge.db"), error))?;
        tx.execute(
            "INSERT INTO profile_sessions (profile_id, session) VALUES (?1, ?2)
             ON CONFLICT (profile_id) DO UPDATE SET session = excluded.session",
            params![list.active, encoded],
        )
        .map_err(sql(dir))?;
        let stored: Option<String> = tx
            .query_row(
                "SELECT session FROM profile_sessions WHERE profile_id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql(dir))?;
        let next = match stored {
            Some(text) => serde_json::from_str::<TabSession>(&text)
                .map_err(|error| crate::sqlite::failure(&dir.join("yforge.db"), error))?,
            None => TabSession::default(),
        };
        write_session(&tx, &next).map_err(sql(dir))?;
        put_setting(&tx, ACTIVE, &id).map_err(sql(dir))?;
    }
    tx.commit().map_err(sql(dir))?;
    publish_author(&target);
    Ok(())
}
