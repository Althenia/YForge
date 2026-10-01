use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use yforge_core::{
    CreatePull, LaunchpadPull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, PullRole,
    RepoRef,
};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter, PAGE_SIZE};
use crate::error::{PlatformError, Result};
use crate::http::{encode, Http};
use crate::paging::{collect, Chunk, Listing, LIST_CAP};
use crate::timestamp::rfc3339_from_millis;

const LABEL: &str = PlatformKind::Bitbucket.label();
const USER_HEADER: &str = "X-AUSERNAME";
const REF_PREFIX: &str = "refs/heads/";

pub(crate) struct BitbucketDataCenter;

#[derive(Deserialize)]
struct Ref {
    #[serde(rename = "displayId")]
    display_id: String,
    repository: Option<Repository>,
}

#[derive(Deserialize)]
struct Repository {
    slug: String,
    project: ProjectKey,
}

#[derive(Deserialize)]
struct ProjectKey {
    key: String,
}

#[derive(Deserialize)]
struct User {
    name: String,
}

#[derive(Deserialize)]
struct Participant {
    user: User,
}

#[derive(Deserialize)]
struct Href {
    href: String,
}

#[derive(Deserialize)]
struct Links {
    #[serde(rename = "self")]
    own: Vec<Href>,
}

#[derive(Deserialize)]
struct Page<T> {
    values: Vec<T>,
    #[serde(rename = "isLastPage", default = "last_by_default")]
    is_last_page: bool,
    #[serde(rename = "nextPageStart")]
    next_page_start: Option<u32>,
}

fn last_by_default() -> bool {
    true
}

impl<T> Page<T> {
    fn next(&self) -> Option<u32> {
        if self.is_last_page {
            None
        } else {
            self.next_page_start
        }
    }
}

#[derive(Deserialize)]
struct Pull {
    id: i64,
    version: i64,
    title: String,
    description: Option<String>,
    state: String,
    #[serde(rename = "fromRef")]
    from_ref: Ref,
    #[serde(rename = "toRef")]
    to_ref: Ref,
    author: Participant,
    #[serde(rename = "createdDate")]
    created_date: i64,
    #[serde(rename = "updatedDate")]
    updated_date: i64,
    links: Links,
    #[serde(default)]
    draft: bool,
}

#[derive(Deserialize, PartialEq)]
struct Path {
    components: Vec<String>,
}

#[derive(Deserialize)]
struct Segment {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    lines: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct Hunk {
    #[serde(default)]
    segments: Vec<Segment>,
}

#[derive(Deserialize)]
struct FileDiff {
    source: Option<Path>,
    destination: Option<Path>,
    #[serde(default)]
    hunks: Vec<Hunk>,
}

#[derive(Deserialize)]
struct Diff {
    diffs: Vec<FileDiff>,
    #[serde(default)]
    truncated: bool,
}

impl From<Pull> for PullRequest {
    fn from(pull: Pull) -> Self {
        let state = match pull.state.as_str() {
            "OPEN" => PrState::Open,
            "MERGED" => PrState::Merged,
            _ => PrState::Closed,
        };
        Self {
            number: pull.id,
            title: pull.title,
            body: pull.description.unwrap_or_default(),
            state,
            source_ref: pull.from_ref.display_id,
            target_ref: pull.to_ref.display_id,
            author: pull.author.user.name,
            created_at: rfc3339_from_millis(pull.created_date),
            updated_at: rfc3339_from_millis(pull.updated_date),
            mergeable: Some(state == PrState::Open),
            web_url: pull
                .links
                .own
                .into_iter()
                .next()
                .map(|link| link.href)
                .unwrap_or_default(),
        }
    }
}

impl From<FileDiff> for PrFile {
    fn from(diff: FileDiff) -> Self {
        let count = |kind: &str| -> i64 {
            diff.hunks
                .iter()
                .flat_map(|hunk| &hunk.segments)
                .filter(|segment| segment.kind == kind)
                .map(|segment| segment.lines.len() as i64)
                .sum()
        };
        let status = match (&diff.source, &diff.destination) {
            (None, _) => "added",
            (_, None) => "removed",
            (Some(source), Some(destination)) if source != destination => "renamed",
            _ => "modified",
        };
        let filename = diff
            .destination
            .as_ref()
            .or(diff.source.as_ref())
            .map(|path| path.components.join("/"))
            .unwrap_or_default();
        Self {
            filename,
            status: status.to_owned(),
            additions: count("ADDED"),
            deletions: count("REMOVED"),
        }
    }
}

fn pulls_path(repo: &RepoRef) -> String {
    format!(
        "/projects/{}/repos/{}/pull-requests",
        encode(&repo.owner),
        encode(&repo.repo)
    )
}

fn branch(repo: &RepoRef, name: &str) -> serde_json::Value {
    json!({
        "id": format!("{REF_PREFIX}{name}"),
        "repository": {"slug": repo.repo, "project": {"key": repo.owner}},
    })
}

async fn mine_role(http: &Http, role: PullRole, name: &str) -> Result<Listing<LaunchpadPull>> {
    let missing = format!("No {LABEL} API found at {}", http.host());
    collect(0_u32, |start| {
        let path = format!(
            "/dashboard/pull-requests?state=OPEN&role={name}&limit={PAGE_SIZE}&start={start}"
        );
        let missing = missing.clone();
        async move {
            let page: Page<Pull> =
                http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
            let next = page.next();
            Ok(Chunk {
                items: page
                    .values
                    .into_iter()
                    .filter_map(|pull| {
                        let repository = pull.to_ref.repository.as_ref()?;
                        let repo = RepoRef {
                            owner: repository.project.key.clone(),
                            repo: repository.slug.clone(),
                        };
                        let draft = pull.draft;
                        Some(LaunchpadPull {
                            connection_id: String::new(),
                            repo,
                            role,
                            draft,
                            pull: pull.into(),
                            local_path: None,
                        })
                    })
                    .collect(),
                total: None,
                next,
            })
        }
    })
    .await
}

impl Adapter for BitbucketDataCenter {
    fn accept(&self) -> &'static str {
        "application/json"
    }

    fn base_url(&self, scheme: &str, host: &str) -> String {
        format!("{scheme}://{host}/rest/api/1.0")
    }

    async fn verify(&self, http: &Http) -> Result<String> {
        let missing = format!("No {LABEL} API found at {}", http.host());
        let (_, user) = http
            .call_with_header("/application-properties", &missing, USER_HEADER)
            .await?;
        user.ok_or_else(|| PlatformError::AuthFailed {
            host: http.host().to_owned(),
            detail: "the server did not identify an authenticated user".to_owned(),
        })
    }

    async fn list(
        &self,
        http: &Http,
        repo: &RepoRef,
        filter: PrFilter,
    ) -> Result<Listing<PullRequest>> {
        let state = match filter {
            PrFilter::Open => "OPEN",
            PrFilter::All => "ALL",
        };
        let missing = repo_missing(LABEL, repo);
        collect(0_u32, |start| {
            let path = format!(
                "{}?state={state}&limit={PAGE_SIZE}&start={start}",
                pulls_path(repo)
            );
            let missing = missing.clone();
            async move {
                let page: Page<Pull> =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                let next = page.next();
                Ok(Chunk {
                    items: page.values.into_iter().map(PullRequest::from).collect(),
                    total: None,
                    next,
                })
            }
        })
        .await
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", pulls_path(repo));
        let missing = pull_missing(LABEL, repo, number);
        let pull = http.call(Method::GET, &path, None, &missing).await?;
        let diff = http
            .call(Method::GET, &format!("{path}/diff"), None, &missing)
            .await?;
        let diff: Diff = http.decode(diff)?;
        let capped = diff.truncated || diff.diffs.len() > LIST_CAP;
        let files: Vec<PrFile> = diff
            .diffs
            .into_iter()
            .take(LIST_CAP)
            .map(PrFile::from)
            .collect();
        Ok(PrDetail {
            pull: http.decode::<Pull>(pull)?.into(),
            files_total: if capped {
                None
            } else {
                u32::try_from(files.len()).ok()
            },
            files_capped: capped,
            files,
        })
    }

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest> {
        let body = json!({
            "title": input.title,
            "description": input.body,
            "fromRef": branch(repo, &input.source_ref),
            "toRef": branch(repo, &input.target_ref),
        });
        let value = http
            .call(
                Method::POST,
                &pulls_path(repo),
                Some(body),
                &repo_missing(LABEL, repo),
            )
            .await?;
        Ok(http.decode::<Pull>(value)?.into())
    }

    async fn merge(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PullRequest> {
        let path = format!("{}/{number}", pulls_path(repo));
        let missing = pull_missing(LABEL, repo, number);
        let current = http.call(Method::GET, &path, None, &missing).await?;
        let version = http.decode::<Pull>(current)?.version;
        let merged = http
            .call(
                Method::POST,
                &format!("{path}/merge?version={version}"),
                None,
                &missing,
            )
            .await?;
        Ok(http.decode::<Pull>(merged)?.into())
    }

    async fn mine(&self, http: &Http) -> Result<Vec<Listing<LaunchpadPull>>> {
        Ok(vec![
            mine_role(http, PullRole::Authored, "AUTHOR").await?,
            mine_role(http, PullRole::ReviewRequested, "REVIEWER").await?,
        ])
    }
}
