use serde::Deserialize;
use yforge_core::{CreatePull, PrDetail, PullRequest, RepoRef};

use crate::error::Result;
use crate::http::Http;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrFilter {
    Open,
    All,
}

pub(crate) trait Adapter {
    fn accept(&self) -> &'static str;

    fn base_url(&self, scheme: &str, host: &str) -> String;

    async fn verify(&self, http: &Http) -> Result<String>;

    async fn list(&self, http: &Http, repo: &RepoRef, filter: PrFilter)
        -> Result<Vec<PullRequest>>;

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail>;

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest>;

    async fn merge(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PullRequest>;
}

pub(crate) fn repo_missing(platform: &str, repo: &RepoRef) -> String {
    format!(
        "No {platform} repository found for {}/{}",
        repo.owner, repo.repo
    )
}

pub(crate) fn pull_missing(platform: &str, repo: &RepoRef, number: i64) -> String {
    format!(
        "No pull request #{number} found in {}/{} on {platform}",
        repo.owner, repo.repo
    )
}
