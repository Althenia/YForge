use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use yforge_core::{
    CreatePull, LaunchpadPull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, PullRole,
    RepoRef,
};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter, PAGE_SIZE};
use crate::error::Result;
use crate::http::{encode, Http};
use crate::paging::{collect, Chunk, Listing};

const LABEL: &str = PlatformKind::GitHub.label();
const CLOUD_HOST: &str = "github.com";
const CLOUD_API: &str = "https://api.github.com";

pub(crate) struct GitHub;

#[derive(Deserialize)]
struct User {
    login: String,
}

#[derive(Deserialize)]
struct Branch {
    r#ref: String,
}

#[derive(Deserialize)]
struct Pull {
    number: i64,
    title: String,
    body: Option<String>,
    state: String,
    merged_at: Option<String>,
    head: Branch,
    base: Branch,
    user: Option<User>,
    created_at: String,
    updated_at: String,
    mergeable: Option<bool>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    changed_files: Option<u32>,
}

#[derive(Deserialize)]
struct SearchItem {
    number: i64,
    repository_url: String,
}

#[derive(Deserialize)]
struct SearchPage {
    items: Vec<SearchItem>,
    total_count: Option<u32>,
}

#[derive(Deserialize)]
struct File {
    filename: String,
    status: String,
    additions: i64,
    deletions: i64,
}

impl From<Pull> for PullRequest {
    fn from(pull: Pull) -> Self {
        let state = match (pull.state.as_str(), pull.merged_at) {
            ("open", _) => PrState::Open,
            (_, Some(_)) => PrState::Merged,
            _ => PrState::Closed,
        };
        Self {
            number: pull.number,
            draft: pull.draft,
            title: pull.title,
            body: pull.body.unwrap_or_default(),
            state,
            source_ref: pull.head.r#ref,
            target_ref: pull.base.r#ref,
            author: pull.user.map(|user| user.login).unwrap_or_default(),
            created_at: pull.created_at,
            updated_at: pull.updated_at,
            mergeable: pull.mergeable,
            web_url: pull.html_url,
        }
    }
}

impl From<File> for PrFile {
    fn from(file: File) -> Self {
        let status = match file.status.as_str() {
            "added" | "copied" => "added",
            "removed" => "removed",
            "renamed" => "renamed",
            _ => "modified",
        };
        Self {
            filename: file.filename,
            status: status.to_owned(),
            additions: file.additions,
            deletions: file.deletions,
        }
    }
}

fn pulls_path(repo: &RepoRef) -> String {
    format!(
        "/repos/{}/{}/pulls",
        encode(&repo.owner),
        encode(&repo.repo)
    )
}

fn repo_of(repository_url: &str) -> Option<RepoRef> {
    let mut segments = repository_url.rsplit('/');
    let repo = segments.next().filter(|name| !name.is_empty())?;
    let owner = segments.next().filter(|name| !name.is_empty())?;
    Some(RepoRef {
        owner: owner.to_owned(),
        repo: repo.to_owned(),
    })
}

async fn mine_role(http: &Http, query: &str, role: PullRole) -> Result<Listing<LaunchpadPull>> {
    let missing = format!("No {LABEL} API found at {}", http.host());
    collect(1_u32, |page| {
        let path = format!(
            "/search/issues?q={}&per_page={PAGE_SIZE}&sort=updated&page={page}",
            encode(query)
        );
        let missing = missing.clone();
        async move {
            let found: SearchPage =
                http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
            let full = found.items.len() == PAGE_SIZE;
            let mut pulls = Vec::new();
            for item in found.items {
                let Some(repo) = repo_of(&item.repository_url) else {
                    continue;
                };
                let path = format!("{}/{}", pulls_path(&repo), item.number);
                let missing = pull_missing(LABEL, &repo, item.number);
                let pull: Pull =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                pulls.push(LaunchpadPull {
                    connection_id: String::new(),
                    repo,
                    role,
                    draft: pull.draft,
                    pull: pull.into(),
                    local_path: None,
                });
            }
            Ok(Chunk {
                items: pulls,
                total: found.total_count,
                next: full.then_some(page + 1),
            })
        }
    })
    .await
}

impl Adapter for GitHub {
    fn accept(&self) -> &'static str {
        "application/vnd.github+json"
    }

    fn base_url(&self, scheme: &str, host: &str) -> String {
        if host == CLOUD_HOST {
            CLOUD_API.to_owned()
        } else {
            format!("{scheme}://{host}/api/v3")
        }
    }

    async fn verify(&self, http: &Http) -> Result<String> {
        let missing = format!("No {LABEL} API found at {}", http.host());
        let value = http.call(Method::GET, "/user", None, &missing).await?;
        Ok(http.decode::<User>(value)?.login)
    }

    async fn list(
        &self,
        http: &Http,
        repo: &RepoRef,
        filter: PrFilter,
    ) -> Result<Listing<PullRequest>> {
        let state = match filter {
            PrFilter::Open => "open",
            PrFilter::All => "all",
        };
        let missing = repo_missing(LABEL, repo);
        collect(1_u32, |page| {
            let path = format!(
                "{}?state={state}&per_page={PAGE_SIZE}&page={page}",
                pulls_path(repo)
            );
            let missing = missing.clone();
            async move {
                let pulls: Vec<Pull> =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                let full = pulls.len() == PAGE_SIZE;
                Ok(Chunk {
                    items: pulls.into_iter().map(PullRequest::from).collect(),
                    total: None,
                    next: full.then_some(page + 1),
                })
            }
        })
        .await
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", pulls_path(repo));
        let missing = pull_missing(LABEL, repo, number);
        let pull: Pull = http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
        let changed = pull.changed_files;
        let files = collect(1_u32, |page| {
            let path = format!("{path}/files?per_page={PAGE_SIZE}&page={page}");
            let missing = missing.clone();
            async move {
                let files: Vec<File> =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                let full = files.len() == PAGE_SIZE;
                Ok(Chunk {
                    items: files.into_iter().map(PrFile::from).collect(),
                    total: changed,
                    next: full.then_some(page + 1),
                })
            }
        })
        .await?;
        Ok(PrDetail {
            pull: pull.into(),
            files: files.items,
            files_total: files.total,
            files_capped: files.capped,
        })
    }

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest> {
        let body = json!({
            "title": input.title,
            "head": input.source_ref,
            "base": input.target_ref,
            "body": input.body,
            "draft": input.draft,
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
        http.call(
            Method::PUT,
            &format!("{path}/merge"),
            Some(Value::Object(Default::default())),
            &missing,
        )
        .await?;
        let value = http.call(Method::GET, &path, None, &missing).await?;
        Ok(http.decode::<Pull>(value)?.into())
    }

    async fn mine(&self, http: &Http) -> Result<Vec<Listing<LaunchpadPull>>> {
        Ok(vec![
            mine_role(http, "is:pr is:open author:@me", PullRole::Authored).await?,
            mine_role(
                http,
                "is:pr is:open review-requested:@me",
                PullRole::ReviewRequested,
            )
            .await?,
        ])
    }
}
