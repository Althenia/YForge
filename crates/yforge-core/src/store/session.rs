use std::collections::HashMap;
use std::path::Path;

use rusqlite::types::Type;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{encode, open, sql};
use crate::error::CoreError;

const GROUP_NAME_LIMIT: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TabGroupColor {
    Cyan,
    Blue,
    Purple,
    Magenta,
    Pink,
    Red,
    Orange,
    Yellow,
    Green,
    Mint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TabGroup {
    pub name: String,
    pub color: TabGroupColor,
    pub collapsed: bool,
    pub tabs: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TabSession {
    pub tabs: Vec<String>,
    pub active: u32,
    #[serde(default)]
    pub groups: Vec<TabGroup>,
}

impl TabSession {
    pub(crate) fn validated(&self) -> Result<Self, CoreError> {
        let mut groups = Vec::with_capacity(self.groups.len());
        let mut grouped = Vec::new();
        for group in self.groups.iter().filter(|group| !group.tabs.is_empty()) {
            let name = group.name.trim();
            if name.is_empty() || name.chars().count() > GROUP_NAME_LIMIT {
                return Err(CoreError::invalid_request(format!(
                    "a tab group name must be 1 to {GROUP_NAME_LIMIT} characters"
                )));
            }
            let mut positions = Vec::with_capacity(group.tabs.len());
            for path in &group.tabs {
                let position = self
                    .tabs
                    .iter()
                    .position(|tab| tab == path)
                    .ok_or_else(|| {
                        CoreError::invalid_request(format!(
                            "tab group {name} holds {path}, which is not an open tab"
                        ))
                    })?;
                if grouped.contains(&position) || positions.contains(&position) {
                    return Err(CoreError::invalid_request(format!(
                        "{path} belongs to more than one tab group"
                    )));
                }
                positions.push(position);
            }
            positions.sort_unstable();
            if positions.windows(2).any(|pair| pair[1] != pair[0] + 1) {
                return Err(CoreError::invalid_request(format!(
                    "the tabs of tab group {name} must sit next to each other"
                )));
            }
            grouped.extend(positions.iter().copied());
            groups.push((
                positions[0],
                TabGroup {
                    name: name.to_owned(),
                    color: group.color,
                    collapsed: group.collapsed,
                    tabs: positions.iter().map(|&at| self.tabs[at].clone()).collect(),
                },
            ));
        }
        groups.sort_by_key(|(first, _)| *first);
        Ok(Self {
            tabs: self.tabs.clone(),
            active: self.active,
            groups: groups.into_iter().map(|(_, group)| group).collect(),
        })
    }
}

pub(crate) fn write_session(conn: &Connection, session: &TabSession) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM session_tabs", [])?;
    conn.execute("DELETE FROM session_groups", [])?;
    for (position, group) in (0_i64..).zip(&session.groups) {
        conn.execute(
            "INSERT INTO session_groups (position, name, color, collapsed) VALUES (?1, ?2, ?3, ?4)",
            params![position, group.name, encode(&group.color)?, group.collapsed],
        )?;
    }
    for (position, path) in (0_i64..).zip(&session.tabs) {
        let group = (0_i64..)
            .zip(&session.groups)
            .find(|(_, group)| group.tabs.contains(path))
            .map(|(index, _)| index);
        conn.execute(
            "INSERT INTO session_tabs (position, path, group_position) VALUES (?1, ?2, ?3)",
            params![position, path, group],
        )?;
    }
    conn.execute(
        "INSERT INTO session (id, active) VALUES (1, ?1)
         ON CONFLICT (id) DO UPDATE SET active = excluded.active",
        [session.active],
    )
    .map(drop)
}

fn read_session(conn: &Connection) -> rusqlite::Result<TabSession> {
    let mut groups = Vec::new();
    let mut index_of = HashMap::new();
    for stored in conn
        .prepare("SELECT position, name, color, collapsed FROM session_groups ORDER BY position")?
        .query_map([], |row| {
            let color: String = row.get(2)?;
            Ok((
                row.get::<_, i64>(0)?,
                TabGroup {
                    name: row.get(1)?,
                    color: serde_json::from_str(&color).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(error))
                    })?,
                    collapsed: row.get(3)?,
                    tabs: Vec::new(),
                },
            ))
        })?
    {
        let (position, group) = stored?;
        index_of.insert(position, groups.len());
        groups.push(group);
    }
    let mut tabs = Vec::new();
    for stored in conn
        .prepare("SELECT path, group_position FROM session_tabs ORDER BY position")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
        })?
    {
        let (path, group) = stored?;
        if let Some(&index) = group.and_then(|position| index_of.get(&position)) {
            groups[index].tabs.push(path.clone());
        }
        tabs.push(path);
    }
    groups.retain(|group| !group.tabs.is_empty());
    let active = conn
        .query_row("SELECT active FROM session WHERE id = 1", [], |row| {
            row.get(0)
        })
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(0),
            other => Err(other),
        })?;
    Ok(TabSession {
        tabs,
        active,
        groups,
    })
}

pub fn load_session(dir: &Path) -> Result<TabSession, CoreError> {
    read_session(&open(dir)?).map_err(sql(dir))
}

pub fn save_session(dir: &Path, session: &TabSession) -> Result<(), CoreError> {
    let saved = session.validated()?;
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    write_session(&tx, &saved).map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))
}
