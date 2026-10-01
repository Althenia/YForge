use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreError;
use crate::store::jira_connections_list;

pub const BRANCH_NAME_LIMIT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum JiraKind {
    Cloud,
    DataCenter,
}

impl JiraKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cloud => "cloud",
            Self::DataCenter => "data_center",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        [Self::Cloud, Self::DataCenter]
            .into_iter()
            .find(|kind| kind.as_str() == text)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct JiraProject {
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct JiraConnection {
    pub id: String,
    pub kind: JiraKind,
    pub site: String,
    pub host: String,
    pub email: Option<String>,
    pub display_name: String,
    pub projects: Vec<JiraProject>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum JiraStatusCategory {
    #[serde(rename = "todo")]
    ToDo,
    #[serde(rename = "in_progress")]
    InProgress,
    #[serde(rename = "done")]
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub status_category: JiraStatusCategory,
    pub issue_type: String,
    pub project: String,
    pub assignee: Option<String>,
    pub updated_at: String,
    pub web_url: String,
    pub connection_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct JiraIssueList {
    pub issues: Vec<JiraIssue>,
    pub total: Option<u32>,
    pub capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct JiraIssueLookup {
    pub key: String,
    pub issue: Option<JiraIssue>,
    pub failure: Option<String>,
}

/// The authority of a site address: `https://jira.example.com/jira` is `jira.example.com`.
pub fn jira_site_host(site: &str) -> String {
    let rest = site.split_once("://").map_or(site, |(_, rest)| rest);
    rest.split('/').next().unwrap_or(rest).to_owned()
}

/// `<KEY>-<summary slug>`: the summary as lower-case ASCII words joined by hyphens, whole
/// words only, at most [`BRANCH_NAME_LIMIT`] characters in all.
pub fn jira_branch_name(key: &str, summary: &str) -> String {
    let mut name: String = key.chars().take(BRANCH_NAME_LIMIT).collect();
    let mut words = 0;
    for word in summary
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
    {
        let room = BRANCH_NAME_LIMIT.saturating_sub(name.len() + 1);
        if room == 0 {
            break;
        }
        name.push('-');
        if word.len() <= room {
            name.push_str(&word.to_ascii_lowercase());
            words += 1;
        } else {
            if words == 0 {
                name.push_str(&word[..room].to_ascii_lowercase());
            } else {
                name.pop();
            }
            break;
        }
    }
    name
}

fn is_key_start(text: &[u8], at: usize) -> bool {
    text[at].is_ascii_uppercase() && (at == 0 || !text[at - 1].is_ascii_alphanumeric())
}

fn key_end(text: &[u8], start: usize) -> Option<usize> {
    let project = text[start..]
        .iter()
        .take_while(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        .count();
    let dash = start + project;
    if project < 2 || text.get(dash) != Some(&b'-') {
        return None;
    }
    let digits = text[dash + 1..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    let end = dash + 1 + digits;
    let glued = text.get(end).is_some_and(u8::is_ascii_alphanumeric);
    (digits > 0 && !glued).then_some(end)
}

/// The issue keys (`[A-Z][A-Z0-9]+-\d+`, case-sensitive) in `text` whose project is in
/// `projects`, in order of first appearance and without repeats.
pub fn jira_issue_keys(text: &str, projects: &BTreeSet<String>) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut keys: Vec<String> = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let found = is_key_start(bytes, at)
            .then(|| key_end(bytes, at))
            .flatten();
        let Some(end) = found else {
            at += 1;
            continue;
        };
        let key = &text[at..end];
        let project = key.rsplit_once('-').map_or(key, |(project, _)| project);
        if projects.contains(project) && !keys.iter().any(|known| known == key) {
            keys.push(key.to_owned());
        }
        at = end;
    }
    keys
}

/// The issue keys in each text, for the projects of every Jira connection.
pub fn jira_issue_keys_in(dir: &Path, texts: &[String]) -> Result<Vec<Vec<String>>, CoreError> {
    let projects: BTreeSet<String> = jira_connections_list(dir)?
        .into_iter()
        .flat_map(|connection| connection.projects)
        .map(|project| project.key)
        .collect();
    Ok(texts
        .iter()
        .map(|text| jira_issue_keys(text, &projects))
        .collect())
}
