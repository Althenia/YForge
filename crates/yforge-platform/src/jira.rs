use reqwest::Method;
use serde::Deserialize;
use yforge_core::{JiraIssue, JiraKind, JiraProject, JiraStatusCategory};

use crate::error::{PlatformError, Result};
use crate::http::{encode, Http};
use crate::paging::{collect, Chunk, Listing};

const ACCEPT: &str = "application/json";
const ISSUE_FIELDS: &str = "summary,status,issuetype,project,assignee,updated";
const ISSUE_PAGE: usize = 100;
const KEYS_PER_LOOKUP: usize = 50;
const PROJECT_PAGE: usize = 100;
const MAX_PROJECT_PAGES: usize = 50;
const MY_ISSUES_JQL: &str =
    "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

enum Cursor {
    Start,
    Token(String),
    Offset(u32),
}

pub(crate) struct JiraClient {
    http: Http,
    kind: JiraKind,
    site: String,
    connection_id: String,
}

#[derive(Deserialize)]
struct Myself {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Project {
    key: String,
    name: String,
}

#[derive(Deserialize)]
struct ProjectPage {
    values: Vec<Project>,
    #[serde(rename = "isLast", default)]
    is_last: bool,
}

#[derive(Deserialize)]
struct Category {
    key: String,
}

#[derive(Deserialize)]
struct Status {
    name: String,
    #[serde(rename = "statusCategory")]
    category: Option<Category>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct ProjectKey {
    key: String,
}

#[derive(Deserialize)]
struct Assignee {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct Fields {
    #[serde(default)]
    summary: String,
    status: Status,
    issuetype: Option<Named>,
    project: Option<ProjectKey>,
    assignee: Option<Assignee>,
    updated: Option<String>,
}

#[derive(Deserialize)]
struct Issue {
    key: String,
    fields: Fields,
}

#[derive(Deserialize)]
struct Search {
    issues: Vec<Issue>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
    total: Option<u32>,
}

fn category_of(key: Option<&str>) -> JiraStatusCategory {
    match key {
        Some("done") => JiraStatusCategory::Done,
        Some("indeterminate") => JiraStatusCategory::InProgress,
        _ => JiraStatusCategory::ToDo,
    }
}

impl JiraClient {
    pub(crate) fn new(
        kind: JiraKind,
        site: &str,
        email: Option<&str>,
        token: &str,
        connection_id: &str,
    ) -> Result<Self> {
        let host = yforge_core::jira_site_host(site);
        let http = match (kind, email) {
            (JiraKind::Cloud, Some(email)) => {
                Http::basic(&host, email, token, format!("{site}/rest/api/3"), ACCEPT)?
            }
            (JiraKind::Cloud, None) => {
                return Err(PlatformError::invalid(
                    "Jira Cloud needs the email of the account that owns the API token",
                ))
            }
            (JiraKind::DataCenter, _) => {
                Http::bearer(&host, token, format!("{site}/rest/api/2"), ACCEPT)?
            }
        };
        Ok(Self {
            http,
            kind,
            site: site.to_owned(),
            connection_id: connection_id.to_owned(),
        })
    }

    fn missing(&self, what: &str) -> String {
        format!("No Jira {what} found at {}", self.http.host())
    }

    /// The display name of the signed-in user and the projects the user can see.
    pub(crate) async fn identify(&self) -> Result<(String, Vec<JiraProject>)> {
        let value = self
            .http
            .call(Method::GET, "/myself", None, &self.missing("API"))
            .await?;
        let me: Myself = self.http.decode(value)?;
        let name = me
            .display_name
            .filter(|name| !name.trim().is_empty())
            .or(me.name)
            .ok_or_else(|| PlatformError::AuthFailed {
                host: self.http.host().to_owned(),
                detail: "the server did not identify an authenticated user".to_owned(),
            })?;
        Ok((name, self.projects().await?))
    }

    async fn projects(&self) -> Result<Vec<JiraProject>> {
        let missing = self.missing("projects");
        let projects = match self.kind {
            JiraKind::DataCenter => {
                let value = self
                    .http
                    .call(Method::GET, "/project", None, &missing)
                    .await?;
                self.http.decode::<Vec<Project>>(value)?
            }
            JiraKind::Cloud => {
                let mut all = Vec::new();
                for _ in 0..MAX_PROJECT_PAGES {
                    let path = format!(
                        "/project/search?maxResults={PROJECT_PAGE}&startAt={}",
                        all.len()
                    );
                    let value = self.http.call(Method::GET, &path, None, &missing).await?;
                    let page: ProjectPage = self.http.decode(value)?;
                    let done = page.is_last || page.values.is_empty();
                    all.extend(page.values);
                    if done {
                        break;
                    }
                }
                all
            }
        };
        Ok(projects
            .into_iter()
            .map(|project| JiraProject {
                key: project.key,
                name: project.name,
            })
            .collect())
    }

    async fn search_page(&self, jql: &str, limit: usize, cursor: &str) -> Result<Search> {
        let endpoint = match self.kind {
            JiraKind::Cloud => "/search/jql",
            JiraKind::DataCenter => "/search",
        };
        let path = format!(
            "{endpoint}?jql={}&fields={}&maxResults={limit}{cursor}",
            encode(jql),
            encode(ISSUE_FIELDS)
        );
        let value = self
            .http
            .call(Method::GET, &path, None, &self.missing("search"))
            .await?;
        self.http.decode(value)
    }

    async fn search(&self, jql: &str, limit: usize) -> Result<Vec<JiraIssue>> {
        let found = self.search_page(jql, limit, "").await?;
        Ok(found
            .issues
            .into_iter()
            .map(|issue| self.issue(issue))
            .collect())
    }

    async fn search_all(&self, jql: &str) -> Result<Listing<JiraIssue>> {
        collect(Cursor::Start, |cursor| async move {
            let query = match &cursor {
                Cursor::Start => String::new(),
                Cursor::Token(token) => format!("&nextPageToken={}", encode(token)),
                Cursor::Offset(start) => format!("&startAt={start}"),
            };
            let found = self.search_page(jql, ISSUE_PAGE, &query).await?;
            let taken = match cursor {
                Cursor::Offset(start) => start as usize,
                _ => 0,
            } + found.issues.len();
            let next = match (self.kind, found.next_page_token) {
                (JiraKind::Cloud, token) => token.map(Cursor::Token),
                (JiraKind::DataCenter, _) => found
                    .total
                    .filter(|total| (taken as u32) < *total)
                    .map(|_| Cursor::Offset(taken as u32)),
            };
            Ok(Chunk {
                total: found.total,
                items: found
                    .issues
                    .into_iter()
                    .map(|issue| self.issue(issue))
                    .collect(),
                next,
            })
        })
        .await
    }

    fn issue(&self, issue: Issue) -> JiraIssue {
        let fields = issue.fields;
        let project = fields
            .project
            .map(|project| project.key)
            .unwrap_or_else(|| issue.key.split('-').next().unwrap_or_default().to_owned());
        JiraIssue {
            web_url: format!("{}/browse/{}", self.site, issue.key),
            key: issue.key,
            summary: fields.summary,
            status_category: category_of(fields.status.category.as_ref().map(|c| c.key.as_str())),
            status: fields.status.name,
            issue_type: fields.issuetype.map(|kind| kind.name).unwrap_or_default(),
            project,
            assignee: fields.assignee.and_then(|assignee| assignee.display_name),
            updated_at: fields.updated.unwrap_or_default(),
            connection_id: self.connection_id.clone(),
        }
    }

    pub(crate) async fn my_issues(&self) -> Result<Listing<JiraIssue>> {
        self.search_all(MY_ISSUES_JQL).await
    }

    pub(crate) async fn issues(&self, keys: &[&str]) -> Result<Vec<JiraIssue>> {
        let mut found = Vec::with_capacity(keys.len());
        for batch in keys.chunks(KEYS_PER_LOOKUP) {
            let jql = format!("key in ({})", batch.join(","));
            found.extend(self.search(&jql, batch.len()).await?);
        }
        Ok(found)
    }
}
