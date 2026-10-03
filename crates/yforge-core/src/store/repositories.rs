use std::collections::{BTreeMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{insert_recent, open, read_recents, sql, RecentRepo};
use crate::error::CoreError;
use crate::sqlite::unix_now;

const DEPTH_LIMIT: u32 = 5;
const CHECK_LIMIT: u32 = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ScannedFolder {
    pub path: String,
    pub depth: u32,
    pub scanned_at: i64,
    pub repos: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ManagedRepo {
    pub path: String,
    pub folder: Option<String>,
    pub opened_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Repositories {
    pub folders: Vec<ScannedFolder>,
    pub repos: Vec<ManagedRepo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FoundRepo {
    pub path: String,
    pub branch: Option<String>,
    pub listed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FolderScan {
    pub root: String,
    pub depth: u32,
    pub checked: u32,
    pub capped: bool,
    pub found: Vec<FoundRepo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Rescan {
    pub added: Vec<String>,
    pub repositories: Repositories,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FolderRemoved {
    pub folder: ScannedFolder,
    pub repositories: Repositories,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RepoRemoved {
    pub removed: ManagedRepo,
    pub repositories: Repositories,
}

struct Walk {
    checked: u32,
    capped: bool,
    found: Vec<String>,
}

impl Walk {
    fn visit(&mut self, dir: &Path, level: u32, depth: u32) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let mut children: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.file_type().is_ok_and(|kind| kind.is_dir()) && searchable(&entry.file_name())
            })
            .map(|entry| entry.path())
            .collect();
        children.sort();
        for child in children {
            if self.checked >= CHECK_LIMIT {
                self.capped = true;
                return;
            }
            self.checked += 1;
            if is_repository(&child) {
                self.found.push(child.display().to_string());
            } else if level < depth {
                self.visit(&child, level + 1, depth);
            }
        }
    }
}

fn searchable(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    !name.starts_with('.') && name != "node_modules"
}

fn is_repository(dir: &Path) -> bool {
    fs::symlink_metadata(dir.join(".git")).is_ok_and(|entry| entry.is_dir() || entry.is_file())
}

fn walk(root: &str, depth: u32) -> Walk {
    let base = Path::new(root);
    let mut walk = Walk {
        checked: 1,
        capped: false,
        found: Vec::new(),
    };
    if is_repository(base) {
        walk.found.push(root.to_owned());
    } else {
        walk.visit(base, 1, depth);
        walk.found.sort();
    }
    walk
}

fn branch(repo: &str) -> Option<String> {
    let head = fs::read_to_string(Path::new(repo).join(".git").join("HEAD")).ok()?;
    head.trim()
        .strip_prefix("ref: refs/heads/")
        .map(str::to_owned)
}

fn normalised(root: &Path) -> String {
    let text = root.to_string_lossy();
    let trimmed = text.trim_end_matches(['/', MAIN_SEPARATOR]);
    if trimmed.is_empty() && !text.is_empty() {
        MAIN_SEPARATOR.to_string()
    } else {
        trimmed.to_owned()
    }
}

fn valid_depth(depth: u32) -> Result<(), CoreError> {
    if (1..=DEPTH_LIMIT).contains(&depth) {
        Ok(())
    } else {
        Err(CoreError::InvalidChoice {
            detail: format!("Choose 1 to {DEPTH_LIMIT} levels."),
        })
    }
}

fn existing_folder(root: &str) -> Result<(), CoreError> {
    if Path::new(root).is_dir() {
        Ok(())
    } else {
        Err(CoreError::NotFound {
            detail: format!("There is no folder at {root}."),
        })
    }
}

fn not_scanned(root: &str) -> CoreError {
    CoreError::NotFound {
        detail: format!("{root} is not a scanned folder."),
    }
}

fn read_folders(conn: &Connection) -> rusqlite::Result<Vec<ScannedFolder>> {
    let mut folders = conn
        .prepare("SELECT path, depth, scanned_at FROM scanned_folders ORDER BY seq")?
        .query_map([], |row| {
            Ok(ScannedFolder {
                path: row.get(0)?,
                depth: row.get(1)?,
                scanned_at: row.get(2)?,
                repos: Vec::new(),
                skipped: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement =
        conn.prepare("SELECT folder, path, skipped FROM scanned_repos ORDER BY seq")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, bool>(2)?,
        ))
    })?;
    for row in rows {
        let (folder, path, skipped) = row?;
        if let Some(owner) = folders.iter_mut().find(|owner| owner.path == folder) {
            if skipped {
                owner.skipped.push(path);
            } else {
                owner.repos.push(path);
            }
        }
    }
    Ok(folders)
}

fn read_repositories(conn: &Connection) -> rusqlite::Result<Repositories> {
    let folders = read_folders(conn)?;
    let mut repos: Vec<ManagedRepo> = read_recents(conn)?
        .into_iter()
        .map(|recent| ManagedRepo {
            path: recent.path,
            folder: None,
            opened_at: Some(recent.opened_at),
        })
        .collect();
    repos.sort_by_key(|repo| std::cmp::Reverse(repo.opened_at));
    let mut never_opened = BTreeMap::new();
    for folder in &folders {
        for path in &folder.repos {
            match repos.iter_mut().find(|repo| repo.path == *path) {
                Some(repo) => {
                    repo.folder.get_or_insert_with(|| folder.path.clone());
                }
                None => {
                    never_opened
                        .entry(path.clone())
                        .or_insert_with(|| ManagedRepo {
                            path: path.clone(),
                            folder: Some(folder.path.clone()),
                            opened_at: None,
                        });
                }
            }
        }
    }
    repos.extend(never_opened.into_values());
    Ok(Repositories { folders, repos })
}

fn insert_repo(conn: &Connection, folder: &str, path: &str, skipped: bool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO scanned_repos (folder, path, skipped) VALUES (?1, ?2, ?3)",
        params![folder, path, skipped],
    )
    .map(drop)
}

fn write_folder(conn: &Connection, path: &str, folder: &ScannedFolder) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO scanned_folders (path, depth, scanned_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (path) DO UPDATE SET depth = excluded.depth, scanned_at = excluded.scanned_at",
        params![path, folder.depth, folder.scanned_at],
    )?;
    conn.execute("DELETE FROM scanned_repos WHERE folder = ?1", [path])?;
    for repo in &folder.repos {
        insert_repo(conn, path, repo, false)?;
    }
    for repo in &folder.skipped {
        insert_repo(conn, path, repo, true)?;
    }
    Ok(())
}

pub fn repositories_list(dir: &Path) -> Result<Repositories, CoreError> {
    read_repositories(&open(dir)?).map_err(sql(dir))
}

pub fn folder_scan(dir: &Path, root: &Path, depth: u32) -> Result<FolderScan, CoreError> {
    valid_depth(depth)?;
    let root = normalised(root);
    existing_folder(&root)?;
    let repositories = repositories_list(dir)?;
    if repositories
        .folders
        .iter()
        .any(|folder| folder.path == root)
    {
        return Err(CoreError::InvalidChoice {
            detail: format!("{root} is already a scanned folder. Rescan it instead."),
        });
    }
    let listed: HashSet<&str> = repositories
        .repos
        .iter()
        .map(|repo| repo.path.as_str())
        .collect();
    let walk = walk(&root, depth);
    let found = walk
        .found
        .into_iter()
        .map(|path| FoundRepo {
            branch: branch(&path),
            listed: listed.contains(path.as_str()),
            path,
        })
        .collect();
    Ok(FolderScan {
        root,
        depth,
        checked: walk.checked,
        capped: walk.capped,
        found,
    })
}

pub fn scan_folder_save(dir: &Path, folder: &ScannedFolder) -> Result<Repositories, CoreError> {
    valid_depth(folder.depth)?;
    let path = normalised(Path::new(&folder.path));
    let mut seen = HashSet::new();
    if let Some(repeated) = folder
        .repos
        .iter()
        .chain(&folder.skipped)
        .find(|repo| !seen.insert(repo.as_str()))
    {
        return Err(CoreError::invalid_request(format!(
            "{repeated} appears more than once in {path}"
        )));
    }
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    write_folder(&tx, &path, folder).map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))?;
    read_repositories(&conn).map_err(sql(dir))
}

pub fn scan_folder_rescan(dir: &Path, root: &Path) -> Result<Rescan, CoreError> {
    let root = normalised(root);
    let mut conn = open(dir)?;
    let folder = read_folders(&conn)
        .map_err(sql(dir))?
        .into_iter()
        .find(|folder| folder.path == root)
        .ok_or_else(|| not_scanned(&root))?;
    existing_folder(&root)?;
    let added: Vec<String> = walk(&root, folder.depth)
        .found
        .into_iter()
        .filter(|path| !folder.repos.contains(path) && !folder.skipped.contains(path))
        .collect();
    let tx = conn.transaction().map_err(sql(dir))?;
    let updated = tx
        .execute(
            "UPDATE scanned_folders SET scanned_at = ?2 WHERE path = ?1",
            params![root, unix_now()],
        )
        .map_err(sql(dir))?;
    if updated == 0 {
        return Err(not_scanned(&root));
    }
    for path in &added {
        insert_repo(&tx, &root, path, false).map_err(sql(dir))?;
    }
    tx.commit().map_err(sql(dir))?;
    Ok(Rescan {
        added,
        repositories: read_repositories(&conn).map_err(sql(dir))?,
    })
}

pub fn scan_folder_remove(dir: &Path, root: &Path) -> Result<FolderRemoved, CoreError> {
    let root = normalised(root);
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    let folder = read_folders(&tx)
        .map_err(sql(dir))?
        .into_iter()
        .find(|folder| folder.path == root)
        .ok_or_else(|| not_scanned(&root))?;
    tx.execute("DELETE FROM scanned_folders WHERE path = ?1", [&root])
        .map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))?;
    Ok(FolderRemoved {
        folder,
        repositories: read_repositories(&conn).map_err(sql(dir))?,
    })
}

pub fn repository_remove(dir: &Path, path: &str) -> Result<RepoRemoved, CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    let removed = read_repositories(&tx)
        .map_err(sql(dir))?
        .repos
        .into_iter()
        .find(|repo| repo.path == path)
        .ok_or_else(|| CoreError::NotFound {
            detail: format!("{path} is not in the list."),
        })?;
    tx.execute("DELETE FROM recents WHERE path = ?1", [path])
        .and_then(|_| {
            tx.execute(
                "UPDATE scanned_repos SET skipped = 1 WHERE path = ?1",
                [path],
            )
        })
        .map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))?;
    Ok(RepoRemoved {
        removed,
        repositories: read_repositories(&conn).map_err(sql(dir))?,
    })
}

pub fn repository_restore(dir: &Path, repo: &ManagedRepo) -> Result<Repositories, CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    if let Some(opened_at) = repo.opened_at {
        insert_recent(
            &tx,
            &RecentRepo {
                path: repo.path.clone(),
                opened_at,
            },
        )
        .map_err(sql(dir))?;
    }
    if let Some(folder) = &repo.folder {
        tx.execute(
            "INSERT INTO scanned_repos (folder, path, skipped)
             SELECT path, ?2, 0 FROM scanned_folders WHERE path = ?1
             ON CONFLICT (folder, path) DO UPDATE SET skipped = 0",
            params![folder, repo.path],
        )
        .map_err(sql(dir))?;
    }
    tx.commit().map_err(sql(dir))?;
    read_repositories(&conn).map_err(sql(dir))
}
