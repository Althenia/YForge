use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use yforge_core::{CreatePull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, RepoRef};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter};
use crate::error::Result;
use crate::http::{encode, Http};

const LABEL: &str = PlatformKind::GitLab.label();

pub(crate) struct GitLab;

#[derive(Deserialize)]
struct User {
    username: String,
}

#[derive(Deserialize)]
struct Change {
    new_path: String,
    #[serde(default)]
    new_file: bool,
    #[serde(default)]
    renamed_file: bool,
    #[serde(default)]
    deleted_file: bool,
    #[serde(default)]
    diff: String,
}

#[derive(Deserialize)]
struct MergeRequest {
    iid: i64,
    title: String,
    description: Option<String>,
    state: String,
    source_branch: String,
    target_branch: String,
    author: Option<User>,
    created_at: String,
    updated_at: String,
    merge_status: Option<String>,
    web_url: String,
    #[serde(default)]
    changes: Vec<Change>,
}

fn line_counts(diff: &str) -> (i64, i64) {
    let mut in_hunk = false;
    let (mut additions, mut deletions) = (0, 0);
    for line in diff.lines() {
        if line.starts_with("@@") {
            in_hunk = true;
        } else if in_hunk {
            match line.as_bytes().first() {
                Some(b'+') => additions += 1,
                Some(b'-') => deletions += 1,
                _ => {}
            }
        }
    }
    (additions, deletions)
}

impl From<Change> for PrFile {
    fn from(change: Change) -> Self {
        let status = if change.new_file {
            "added"
        } else if change.deleted_file {
            "removed"
        } else if change.renamed_file {
            "renamed"
        } else {
            "modified"
        };
        let (additions, deletions) = line_counts(&change.diff);
        Self {
            filename: change.new_path,
            status: status.to_owned(),
            additions,
            deletions,
        }
    }
}

impl MergeRequest {
    fn split(self) -> (PullRequest, Vec<Change>) {
        let state = match self.state.as_str() {
            "opened" => PrState::Open,
            "merged" => PrState::Merged,
            _ => PrState::Closed,
        };
        let mergeable = match self.merge_status.as_deref() {
            Some("can_merge") => Some(true),
            Some("cannot_be_merged") => Some(false),
            _ => None,
        };
        let pull = PullRequest {
            number: self.iid,
            title: self.title,
            body: self.description.unwrap_or_default(),
            state,
            source_ref: self.source_branch,
            target_ref: self.target_branch,
            author: self.author.map(|user| user.username).unwrap_or_default(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            mergeable,
            web_url: self.web_url,
        };
        (pull, self.changes)
    }
}

fn requests_path(repo: &RepoRef) -> String {
    let project = encode(&format!("{}/{}", repo.owner, repo.repo));
    format!("/projects/{project}/merge_requests")
}

impl Adapter for GitLab {
    fn accept(&self) -> &'static str {
        "application/json"
    }

    fn base_url(&self, scheme: &str, host: &str) -> String {
        format!("{scheme}://{host}/api/v4")
    }

    async fn verify(&self, http: &Http) -> Result<String> {
        let missing = format!("No {LABEL} API found at {}", http.host());
        let value = http.call(Method::GET, "/user", None, &missing).await?;
        Ok(http.decode::<User>(value)?.username)
    }

    async fn list(
        &self,
        http: &Http,
        repo: &RepoRef,
        filter: PrFilter,
    ) -> Result<Vec<PullRequest>> {
        let state = match filter {
            PrFilter::Open => "opened",
            PrFilter::All => "all",
        };
        let path = format!("{}?state={state}&per_page=100", requests_path(repo));
        let value = http
            .call(Method::GET, &path, None, &repo_missing(LABEL, repo))
            .await?;
        let requests: Vec<MergeRequest> = http.decode(value)?;
        Ok(requests
            .into_iter()
            .map(|request| request.split().0)
            .collect())
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", requests_path(repo));
        let value = http
            .call(Method::GET, &path, None, &pull_missing(LABEL, repo, number))
            .await?;
        let (pull, changes) = http.decode::<MergeRequest>(value)?.split();
        Ok(PrDetail {
            pull,
            files: changes.into_iter().map(PrFile::from).collect(),
        })
    }

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest> {
        let body = json!({
            "source_branch": input.source_ref,
            "target_branch": input.target_ref,
            "title": input.title,
            "description": input.body,
        });
        let value = http
            .call(
                Method::POST,
                &requests_path(repo),
                Some(body),
                &repo_missing(LABEL, repo),
            )
            .await?;
        Ok(http.decode::<MergeRequest>(value)?.split().0)
    }

    async fn merge(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PullRequest> {
        let path = format!("{}/{number}/merge", requests_path(repo));
        let value = http
            .call(Method::PUT, &path, None, &pull_missing(LABEL, repo, number))
            .await?;
        Ok(http.decode::<MergeRequest>(value)?.split().0)
    }
}
