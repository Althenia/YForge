use yforge_core::{
    CreatePull, LaunchpadPull, LaunchpadPulls, PlatformConnection, PlatformKind, PrDetail,
    PullList, PullRequest, RepoRef,
};

use crate::adapter::{Adapter, PrFilter};
use crate::bitbucket_cloud::{self, BitbucketCloud};
use crate::bitbucket_data_center::BitbucketDataCenter;
use crate::error::Result;
use crate::github::GitHub;
use crate::gitlab::GitLab;
use crate::http::{scheme_for, Http};
use crate::paging::LIST_CAP;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Api {
    GitHub,
    GitLab,
    BitbucketCloud,
    BitbucketDataCenter,
}

impl Api {
    fn of(connection: &PlatformConnection) -> Self {
        match connection.kind {
            PlatformKind::GitHub => Self::GitHub,
            PlatformKind::GitLab => Self::GitLab,
            PlatformKind::Bitbucket if connection.host == bitbucket_cloud::HOST => {
                Self::BitbucketCloud
            }
            PlatformKind::Bitbucket => Self::BitbucketDataCenter,
        }
    }
}

macro_rules! with_adapter {
    ($api:expr, $adapter:ident => $body:expr) => {
        match $api {
            Api::GitHub => {
                let $adapter = GitHub;
                $body
            }
            Api::GitLab => {
                let $adapter = GitLab;
                $body
            }
            Api::BitbucketCloud => {
                let $adapter = BitbucketCloud;
                $body
            }
            Api::BitbucketDataCenter => {
                let $adapter = BitbucketDataCenter;
                $body
            }
        }
    };
}

fn base_url(api: Api, connection: &PlatformConnection) -> String {
    let scheme = scheme_for(&connection.host);
    with_adapter!(api, adapter => adapter.base_url(scheme, &connection.host))
}

pub struct Client {
    api: Api,
    http: Http,
    connection_id: String,
}

impl Client {
    pub fn new(connection: &PlatformConnection, token: &str) -> Result<Self> {
        let api = Api::of(connection);
        let accept = with_adapter!(api, adapter => adapter.accept());
        let http = Http::new(connection, token, base_url(api, connection), accept)?;
        Ok(Self {
            api,
            http,
            connection_id: connection.id.clone(),
        })
    }

    pub async fn verify(&self) -> Result<String> {
        with_adapter!(self.api, adapter => adapter.verify(&self.http).await)
    }

    pub async fn list(&self, repo: &RepoRef, filter: PrFilter) -> Result<PullList> {
        let listing =
            with_adapter!(self.api, adapter => adapter.list(&self.http, repo, filter).await)?;
        Ok(PullList {
            pulls: listing.items,
            total: listing.total,
            capped: listing.capped,
        })
    }

    pub async fn detail(&self, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        with_adapter!(self.api, adapter => adapter.detail(&self.http, repo, number).await)
    }

    pub async fn create(&self, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest> {
        with_adapter!(self.api, adapter => adapter.create(&self.http, repo, input).await)
    }

    /// The user's open pull requests (authored first, then review requests), a pull request
    /// that is both listed once as authored, the most recently updated first, at most
    /// `LIST_CAP` of them. `total` adds up the totals of the roles, so a capped list counts a
    /// pull request that is in both roles twice.
    pub async fn mine(&self) -> Result<LaunchpadPulls> {
        let roles = with_adapter!(self.api, adapter => adapter.mine(&self.http).await)?;
        let total: Option<u32> = roles.iter().map(|role| role.total).sum::<Option<u32>>();
        let mut capped = roles.iter().any(|role| role.capped);
        let mut pulls: Vec<LaunchpadPull> = Vec::new();
        for mut pull in roles.into_iter().flat_map(|role| role.items) {
            pull.connection_id = self.connection_id.clone();
            let same = |other: &LaunchpadPull| {
                other.repo.owner.eq_ignore_ascii_case(&pull.repo.owner)
                    && other.repo.repo.eq_ignore_ascii_case(&pull.repo.repo)
                    && other.pull.number == pull.pull.number
            };
            if !pulls.iter().any(same) {
                pulls.push(pull);
            }
        }
        pulls.sort_by(|a, b| b.pull.updated_at.cmp(&a.pull.updated_at));
        if pulls.len() > LIST_CAP {
            pulls.truncate(LIST_CAP);
            capped = true;
        }
        let total = if capped {
            total
        } else {
            u32::try_from(pulls.len()).ok()
        };
        Ok(LaunchpadPulls {
            pulls,
            total,
            capped,
        })
    }

    pub async fn merge(&self, repo: &RepoRef, number: i64) -> Result<PullRequest> {
        with_adapter!(self.api, adapter => adapter.merge(&self.http, repo, number).await)
    }
}

#[cfg(test)]
mod tests {
    use super::{base_url, Api};
    use yforge_core::{PlatformConnection, PlatformKind};

    fn connection(kind: PlatformKind, host: &str) -> PlatformConnection {
        PlatformConnection {
            id: "c".to_owned(),
            kind,
            host: host.to_owned(),
            name: "n".to_owned(),
            insecure_tls: false,
            created_at: 0,
        }
    }

    fn route(kind: PlatformKind, host: &str) -> (Api, String) {
        let connection = connection(kind, host);
        let api = Api::of(&connection);
        (api, base_url(api, &connection))
    }

    #[test]
    fn bitbucket_org_routes_to_the_cloud_2_0_api() {
        assert_eq!(
            route(PlatformKind::Bitbucket, "bitbucket.org"),
            (
                Api::BitbucketCloud,
                "https://api.bitbucket.org/2.0".to_owned()
            )
        );
    }

    #[test]
    fn any_other_bitbucket_host_routes_to_the_data_center_1_0_api() {
        assert_eq!(
            route(PlatformKind::Bitbucket, "git.example.com"),
            (
                Api::BitbucketDataCenter,
                "https://git.example.com/rest/api/1.0".to_owned()
            )
        );
        assert_eq!(
            route(PlatformKind::Bitbucket, "127.0.0.1:7990"),
            (
                Api::BitbucketDataCenter,
                "http://127.0.0.1:7990/rest/api/1.0".to_owned()
            )
        );
    }

    #[test]
    fn github_bases_are_the_public_api_and_the_enterprise_api_v3_path() {
        assert_eq!(
            route(PlatformKind::GitHub, "github.com").1,
            "https://api.github.com"
        );
        assert_eq!(
            route(PlatformKind::GitHub, "ghe.example.com").1,
            "https://ghe.example.com/api/v3"
        );
    }
}
