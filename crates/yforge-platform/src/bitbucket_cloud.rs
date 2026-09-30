use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use yforge_core::{CreatePull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, RepoRef};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter};
use crate::error::Result;
use crate::http::{encode, Http};

const LABEL: &str = PlatformKind::Bitbucket.label();
pub(crate) const HOST: &str = "bitbucket.org";
const CLOUD_API: &str = "https://api.bitbucket.org/2.0";
const ALL_STATES: &str = "state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED";

pub(crate) struct BitbucketCloud;

#[derive(Deserialize)]
struct Actor {
    username: Option<String>,
    nickname: Option<String>,
}

impl Actor {
    fn login(self) -> String {
        self.username.or(self.nickname).unwrap_or_default()
    }
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct End {
    branch: Named,
}

#[derive(Deserialize)]
struct Href {
    href: String,
}

#[derive(Deserialize)]
struct Links {
    html: Href,
}

#[derive(Deserialize)]
struct Page<T> {
    values: Vec<T>,
}

#[derive(Deserialize)]
struct Pull {
    id: i64,
    title: String,
    description: Option<String>,
    state: String,
    source: End,
    destination: End,
    author: Option<Actor>,
    created_on: String,
    updated_on: String,
    links: Links,
}

#[derive(Deserialize)]
struct Location {
    path: String,
}

#[derive(Deserialize)]
struct DiffStat {
    status: String,
    lines_added: i64,
    lines_removed: i64,
    old: Option<Location>,
    new: Option<Location>,
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
            source_ref: pull.source.branch.name,
            target_ref: pull.destination.branch.name,
            author: pull.author.map(Actor::login).unwrap_or_default(),
            created_at: pull.created_on,
            updated_at: pull.updated_on,
            mergeable: Some(state == PrState::Open),
            web_url: pull.links.html.href,
        }
    }
}

impl From<DiffStat> for PrFile {
    fn from(stat: DiffStat) -> Self {
        let status = match stat.status.as_str() {
            "added" | "removed" | "renamed" => stat.status.as_str(),
            _ => "modified",
        };
        let filename = stat
            .new
            .or(stat.old)
            .map(|location| location.path)
            .unwrap_or_default();
        Self {
            filename,
            status: status.to_owned(),
            additions: stat.lines_added,
            deletions: stat.lines_removed,
        }
    }
}

fn pulls_path(repo: &RepoRef) -> String {
    format!(
        "/repositories/{}/{}/pullrequests",
        encode(&repo.owner),
        encode(&repo.repo)
    )
}

impl Adapter for BitbucketCloud {
    fn accept(&self) -> &'static str {
        "application/json"
    }

    fn base_url(&self, _scheme: &str, _host: &str) -> String {
        CLOUD_API.to_owned()
    }

    async fn verify(&self, http: &Http) -> Result<String> {
        let missing = format!("No {LABEL} API found at {}", http.host());
        let value = http.call(Method::GET, "/user", None, &missing).await?;
        Ok(http.decode::<Actor>(value)?.login())
    }

    async fn list(
        &self,
        http: &Http,
        repo: &RepoRef,
        filter: PrFilter,
    ) -> Result<Vec<PullRequest>> {
        let states = match filter {
            PrFilter::Open => "state=OPEN",
            PrFilter::All => ALL_STATES,
        };
        let path = format!("{}?{states}", pulls_path(repo));
        let value = http
            .call(Method::GET, &path, None, &repo_missing(LABEL, repo))
            .await?;
        let page: Page<Pull> = http.decode(value)?;
        Ok(page.values.into_iter().map(PullRequest::from).collect())
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", pulls_path(repo));
        let missing = pull_missing(LABEL, repo, number);
        let pull = http.call(Method::GET, &path, None, &missing).await?;
        let stats = http
            .call(Method::GET, &format!("{path}/diffstat"), None, &missing)
            .await?;
        let stats: Page<DiffStat> = http.decode(stats)?;
        Ok(PrDetail {
            pull: http.decode::<Pull>(pull)?.into(),
            files: stats.values.into_iter().map(PrFile::from).collect(),
        })
    }

    async fn create(&self, http: &Http, repo: &RepoRef, input: &CreatePull) -> Result<PullRequest> {
        let body = json!({
            "title": input.title,
            "description": input.body,
            "source": {"branch": {"name": input.source_ref}},
            "destination": {"branch": {"name": input.target_ref}},
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
        let path = format!("{}/{number}/merge", pulls_path(repo));
        let value = http
            .call(
                Method::POST,
                &path,
                None,
                &pull_missing(LABEL, repo, number),
            )
            .await?;
        Ok(http.decode::<Pull>(value)?.into())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use yforge_core::{CreatePull, PlatformKind, PrState, RepoRef};

    use super::BitbucketCloud;
    use crate::adapter::{Adapter, PrFilter};
    use crate::fake::{HttpFake, Recorded, Reply};
    use crate::http::Http;

    fn repo() -> RepoRef {
        RepoRef {
            owner: "acme".to_owned(),
            repo: "widget".to_owned(),
        }
    }

    fn input() -> CreatePull {
        CreatePull {
            source_ref: "feature".to_owned(),
            target_ref: "main".to_owned(),
            title: "Add thing".to_owned(),
            body: "Because.".to_owned(),
        }
    }

    fn http(fake: &HttpFake) -> Http {
        Http::new(
            &fake.connection(PlatformKind::Bitbucket),
            "tok-secret",
            format!("http://{}/2.0", fake.host),
            BitbucketCloud.accept(),
        )
        .unwrap()
    }

    fn json_of(request: &Recorded) -> Value {
        serde_json::from_str(&request.body).unwrap()
    }

    fn assert_call(request: &Recorded, method: &str, path: &str) {
        assert_eq!(
            (request.method.as_str(), request.path.as_str()),
            (method, path)
        );
        assert_eq!(request.header("authorization"), Some("Bearer tok-secret"));
    }

    fn bitbucket_pull(state: &str) -> Value {
        json!({
            "id": 5, "title": "Add thing", "description": "Because.", "state": state,
            "source": {"branch": {"name": "feature"}},
            "destination": {"branch": {"name": "main"}},
            "author": {"username": "yui"}, "created_on": "2026-09-01T10:00:00Z",
            "updated_on": "2026-09-02T10:00:00Z",
            "links": {"html": {"href": "https://bitbucket.example/acme/widget/pull-requests/5"}}
        })
    }

    #[tokio::test]
    async fn cloud_verify_reads_the_username() {
        let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));

        let login = BitbucketCloud.verify(&http(&fake)).await.unwrap();

        assert_eq!(login, "yui");
        assert_call(&fake.requests()[0], "GET", "/2.0/user");
    }

    #[tokio::test]
    async fn cloud_list_maps_states_and_derives_mergeability_from_open() {
        let fake = HttpFake::start(|_| {
            Reply::ok(
                &json!({"values": [
                    bitbucket_pull("OPEN"), bitbucket_pull("MERGED"),
                    bitbucket_pull("DECLINED"), bitbucket_pull("REJECTED")
                ]})
                .to_string(),
            )
        });
        let bitbucket = http(&fake);

        let pulls = BitbucketCloud
            .list(&bitbucket, &repo(), PrFilter::Open)
            .await
            .unwrap();
        BitbucketCloud
            .list(&bitbucket, &repo(), PrFilter::All)
            .await
            .unwrap();

        let requests = fake.requests();
        assert_call(
            &requests[0],
            "GET",
            "/2.0/repositories/acme/widget/pullrequests?state=OPEN",
        );
        assert_call(
            &requests[1],
            "GET",
            "/2.0/repositories/acme/widget/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED",
        );
        let states: Vec<PrState> = pulls.iter().map(|pull| pull.state).collect();
        assert_eq!(
            states,
            [
                PrState::Open,
                PrState::Merged,
                PrState::Closed,
                PrState::Closed
            ]
        );
        let mergeable: Vec<Option<bool>> = pulls.iter().map(|pull| pull.mergeable).collect();
        assert_eq!(
            mergeable,
            [Some(true), Some(false), Some(false), Some(false)]
        );
        let first = &pulls[0];
        assert_eq!((first.number, first.author.as_str()), (5, "yui"));
        assert_eq!(
            (first.source_ref.as_str(), first.target_ref.as_str()),
            ("feature", "main")
        );
        assert_eq!(
            first.web_url,
            "https://bitbucket.example/acme/widget/pull-requests/5"
        );
    }

    #[tokio::test]
    async fn cloud_detail_joins_the_pull_and_its_diffstat() {
        let fake = HttpFake::start(|request| {
            if request.path.ends_with("/diffstat") {
                Reply::ok(
                    &json!({"values": [
                        {"status": "added", "lines_added": 4, "lines_removed": 0,
                         "old": null, "new": {"path": "a.rs"}},
                        {"status": "removed", "lines_added": 0, "lines_removed": 3,
                         "old": {"path": "b.rs"}, "new": null},
                        {"status": "merge conflict", "lines_added": 1, "lines_removed": 1,
                         "old": {"path": "c.rs"}, "new": {"path": "c.rs"}}
                    ]})
                    .to_string(),
                )
            } else {
                Reply::ok(&bitbucket_pull("OPEN").to_string())
            }
        });

        let detail = BitbucketCloud
            .detail(&http(&fake), &repo(), 5)
            .await
            .unwrap();

        let requests = fake.requests();
        assert_call(
            &requests[0],
            "GET",
            "/2.0/repositories/acme/widget/pullrequests/5",
        );
        assert_call(
            &requests[1],
            "GET",
            "/2.0/repositories/acme/widget/pullrequests/5/diffstat",
        );
        let files: Vec<(&str, &str, i64, i64)> = detail
            .files
            .iter()
            .map(|file| {
                (
                    file.filename.as_str(),
                    file.status.as_str(),
                    file.additions,
                    file.deletions,
                )
            })
            .collect();
        assert_eq!(
            files,
            [
                ("a.rs", "added", 4, 0),
                ("b.rs", "removed", 0, 3),
                ("c.rs", "modified", 1, 1)
            ]
        );
    }

    #[tokio::test]
    async fn cloud_create_and_merge_post_to_pullrequest_endpoints() {
        let fake = HttpFake::start(|request| {
            Reply::ok(
                &bitbucket_pull(if request.path.ends_with("/merge") {
                    "MERGED"
                } else {
                    "OPEN"
                })
                .to_string(),
            )
        });
        let bitbucket = http(&fake);

        let created = BitbucketCloud
            .create(&bitbucket, &repo(), &input())
            .await
            .unwrap();
        let merged = BitbucketCloud.merge(&bitbucket, &repo(), 5).await.unwrap();

        let requests = fake.requests();
        assert_call(
            &requests[0],
            "POST",
            "/2.0/repositories/acme/widget/pullrequests",
        );
        assert_eq!(
            json_of(&requests[0]),
            json!({"title": "Add thing", "description": "Because.",
                   "source": {"branch": {"name": "feature"}},
                   "destination": {"branch": {"name": "main"}}})
        );
        assert_call(
            &requests[1],
            "POST",
            "/2.0/repositories/acme/widget/pullrequests/5/merge",
        );
        assert_eq!(
            (created.state, merged.state),
            (PrState::Open, PrState::Merged)
        );
    }
}
