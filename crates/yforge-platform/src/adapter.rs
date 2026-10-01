use serde::Deserialize;
use yforge_core::{CreatePull, LaunchpadPull, PrDetail, PullRequest, RepoRef};

use crate::error::Result;
use crate::http::Http;
use crate::paging::Listing;

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

    async fn list(
        &self,
        http: &Http,
        repo: &RepoRef,
        filter: PrFilter,
    ) -> Result<Listing<PullRequest>>;

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail>;

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest>;

    async fn merge(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PullRequest>;

    /// The open pull requests the signed-in user authored or was asked to review, across
    /// every repository the platform lets them see: one listing per role.
    async fn mine(&self, http: &Http) -> Result<Vec<Listing<LaunchpadPull>>>;
}

pub(crate) const PAGE_SIZE: usize = 100;

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
