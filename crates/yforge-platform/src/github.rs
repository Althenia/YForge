use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use yforge_core::{CreatePull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, RepoRef};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter};
use crate::error::Result;
use crate::http::{encode, Http};

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
    ) -> Result<Vec<PullRequest>> {
        let state = match filter {
            PrFilter::Open => "open",
            PrFilter::All => "all",
        };
        let path = format!("{}?state={state}&per_page=100", pulls_path(repo));
        let value = http
            .call(Method::GET, &path, None, &repo_missing(LABEL, repo))
            .await?;
        let pulls: Vec<Pull> = http.decode(value)?;
        Ok(pulls.into_iter().map(PullRequest::from).collect())
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", pulls_path(repo));
        let missing = pull_missing(LABEL, repo, number);
        let pull = http.call(Method::GET, &path, None, &missing).await?;
        let files = http
            .call(
                Method::GET,
                &format!("{path}/files?per_page=100"),
                None,
                &missing,
            )
            .await?;
        let files: Vec<File> = http.decode(files)?;
        Ok(PrDetail {
            pull: http.decode::<Pull>(pull)?.into(),
            files: files.into_iter().map(PrFile::from).collect(),
        })
    }

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest> {
        let body = json!({
            "title": input.title,
            "head": input.source_ref,
            "base": input.target_ref,
            "body": input.body,
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
}
