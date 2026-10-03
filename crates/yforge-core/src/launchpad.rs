use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreError;
use crate::platform::{PullRequest, RepoRef};
use crate::store::{recent_status, repositories_list};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PullRole {
    Authored,
    ReviewRequested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct LaunchpadPull {
    pub connection_id: String,
    pub repo: RepoRef,
    pub role: PullRole,
    pub draft: bool,
    pub pull: PullRequest,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct LaunchpadPulls {
    pub pulls: Vec<LaunchpadPull>,
    pub total: Option<u32>,
    pub capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Wip {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub changes: u32,
    pub unpushed: u32,
    pub unreadable: Option<String>,
}

/// The listed repositories with uncommitted changes, unpushed commits or an unreadable status, in list order.
pub fn launchpad_wips(dir: &Path) -> Result<Vec<Wip>, CoreError> {
    Ok(repositories_list(dir)?
        .repos
        .into_iter()
        .filter_map(|repo| {
            let status = recent_status(Path::new(&repo.path));
            let changes = status.counts.map_or(0, |counts| counts.total());
            let unpushed = status.ahead_behind.map_or(0, |count| count.ahead);
            if !status.exists || (status.unreadable.is_none() && changes + unpushed == 0) {
                return None;
            }
            let name = Path::new(&repo.path).file_name().map_or_else(
                || repo.path.clone(),
                |name| name.to_string_lossy().into_owned(),
            );
            Some(Wip {
                path: repo.path,
                name,
                branch: status.branch,
                changes,
                unpushed,
                unreadable: status.unreadable,
            })
        })
        .collect())
}
