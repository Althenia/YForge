use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use yforge_core::{
    CreatePull, LaunchpadPull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, PullRole,
    RepoRef,
};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter, PAGE_SIZE};
use crate::error::Result;
use crate::http::{encode, Http};
use crate::paging::{collect, Chunk, Listing, LIST_CAP};

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
    draft: bool,
    #[serde(default)]
    changes: Vec<Change>,
    changes_count: Option<String>,
    #[serde(default)]
    overflow: bool,
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

struct Split {
    pull: PullRequest,
    changes: Vec<Change>,
    changes_total: Option<u32>,
    changes_capped: bool,
}

impl MergeRequest {
    fn split(self) -> (PullRequest, Vec<Change>) {
        let split = self.divide();
        (split.pull, split.changes)
    }

    fn divide(self) -> Split {
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
        let changes_total = self
            .changes_count
            .as_deref()
            .and_then(|count| count.parse::<u32>().ok());
        let changes_capped = self.overflow
            || self
                .changes_count
                .as_deref()
                .is_some_and(|count| count.ends_with('+'))
            || self.changes.len() > LIST_CAP;
        Split {
            pull,
            changes: self.changes,
            changes_total,
            changes_capped,
        }
    }
}

fn total_of(header: Option<&String>) -> Option<u32> {
    header.and_then(|text| text.trim().parse().ok())
}

fn next_of(header: Option<&String>) -> Option<u32> {
    total_of(header)
}

fn requests_path(repo: &RepoRef) -> String {
    let project = encode(&format!("{}/{}", repo.owner, repo.repo));
    format!("/projects/{project}/merge_requests")
}

fn repo_of(web_url: &str) -> Option<RepoRef> {
    let (before, _) = web_url.split_once("/merge_requests/")?;
    let path = before.strip_suffix("/-").unwrap_or(before);
    let (_, path) = path.split_once("://")?.1.split_once('/')?;
    let (owner, repo) = path.rsplit_once('/')?;
    Some(RepoRef {
        owner: owner.to_owned(),
        repo: repo.to_owned(),
    })
}

async fn mine_role(http: &Http, filter: &str, role: PullRole) -> Result<Listing<LaunchpadPull>> {
    let missing = format!("No {LABEL} API found at {}", http.host());
    collect(1_u32, |page| {
        let path =
            format!("/merge_requests?state=opened&{filter}&per_page={PAGE_SIZE}&page={page}");
        let missing = missing.clone();
        async move {
            let (value, headers) = http
                .call_with_headers(&path, &missing, &["X-Total", "X-Next-Page"])
                .await?;
            let requests: Vec<MergeRequest> = http.decode(value)?;
            Ok(Chunk {
                items: requests
                    .into_iter()
                    .filter_map(|request| {
                        let repo = repo_of(&request.web_url)?;
                        let draft = request.draft;
                        Some(LaunchpadPull {
                            connection_id: String::new(),
                            repo,
                            role,
                            draft,
                            pull: request.split().0,
                            local_path: None,
                        })
                    })
                    .collect(),
                total: total_of(headers[0].as_ref()),
                next: next_of(headers[1].as_ref()),
            })
        }
    })
    .await
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
    ) -> Result<Listing<PullRequest>> {
        let state = match filter {
            PrFilter::Open => "opened",
            PrFilter::All => "all",
        };
        let missing = repo_missing(LABEL, repo);
        collect(1_u32, |page| {
            let path = format!(
                "{}?state={state}&per_page={PAGE_SIZE}&page={page}",
                requests_path(repo)
            );
            let missing = missing.clone();
            async move {
                let (value, headers) = http
                    .call_with_headers(&path, &missing, &["X-Total", "X-Next-Page"])
                    .await?;
                let requests: Vec<MergeRequest> = http.decode(value)?;
                Ok(Chunk {
                    items: requests
                        .into_iter()
                        .map(|request| request.split().0)
                        .collect(),
                    total: total_of(headers[0].as_ref()),
                    next: next_of(headers[1].as_ref()),
                })
            }
        })
        .await
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", requests_path(repo));
        let value = http
            .call(Method::GET, &path, None, &pull_missing(LABEL, repo, number))
            .await?;
        let split = http.decode::<MergeRequest>(value)?.divide();
        let files: Vec<PrFile> = split
            .changes
            .into_iter()
            .take(LIST_CAP)
            .map(PrFile::from)
            .collect();
        Ok(PrDetail {
            pull: split.pull,
            files_total: if split.changes_capped {
                split.changes_total
            } else {
                u32::try_from(files.len()).ok()
            },
            files_capped: split.changes_capped,
            files,
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

    async fn mine(&self, http: &Http) -> Result<Vec<Listing<LaunchpadPull>>> {
        let username = self.verify(http).await?;
        let reviewing = format!("scope=all&reviewer_username={}", encode(&username));
        Ok(vec![
            mine_role(http, "scope=created_by_me", PullRole::Authored).await?,
            mine_role(http, &reviewing, PullRole::ReviewRequested).await?,
        ])
    }
}
