use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use yforge_core::{
    CreatePull, LaunchpadPull, PlatformKind, PrDetail, PrFile, PrState, PullRequest, PullRole,
    RepoRef,
};

use crate::adapter::{pull_missing, repo_missing, Adapter, PrFilter};
use crate::error::{PlatformError, Result};
use crate::http::{encode, Http};
use crate::paging::{collect, Chunk, Listing};

const LABEL: &str = PlatformKind::Bitbucket.label();
pub(crate) const HOST: &str = "bitbucket.org";
const CLOUD_API: &str = "https://api.bitbucket.org/2.0";
const PULL_PAGE: usize = 50;
const STAT_PAGE: usize = 500;
const ALL_STATES: &str = "state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED";

pub(crate) struct BitbucketCloud;

#[derive(Deserialize)]
struct Actor {
    username: Option<String>,
    nickname: Option<String>,
    account_id: Option<String>,
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
    repository: Option<FullName>,
}

#[derive(Deserialize)]
struct FullName {
    full_name: String,
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
    next: Option<String>,
    size: Option<u32>,
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
    #[serde(default)]
    draft: bool,
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
    ) -> Result<Listing<PullRequest>> {
        let states = match filter {
            PrFilter::Open => "state=OPEN",
            PrFilter::All => ALL_STATES,
        };
        let first = format!("{}?{states}&pagelen={PULL_PAGE}", pulls_path(repo));
        let missing = repo_missing(LABEL, repo);
        collect(first, |path| {
            let missing = missing.clone();
            async move {
                let page: Page<Pull> =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                Ok(Chunk {
                    items: page.values.into_iter().map(PullRequest::from).collect(),
                    total: page.size,
                    next: page.next.as_deref().and_then(|url| http.relative(url)),
                })
            }
        })
        .await
    }

    async fn detail(&self, http: &Http, repo: &RepoRef, number: i64) -> Result<PrDetail> {
        let path = format!("{}/{number}", pulls_path(repo));
        let missing = pull_missing(LABEL, repo, number);
        let pull = http.call(Method::GET, &path, None, &missing).await?;
        let first = format!("{path}/diffstat?pagelen={STAT_PAGE}");
        let files = collect(first, |path| {
            let missing = missing.clone();
            async move {
                let page: Page<DiffStat> =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                Ok(Chunk {
                    items: page.values.into_iter().map(PrFile::from).collect(),
                    total: page.size,
                    next: page.next.as_deref().and_then(|url| http.relative(url)),
                })
            }
        })
        .await?;
        Ok(PrDetail {
            pull: http.decode::<Pull>(pull)?.into(),
            files: files.items,
            files_total: files.total,
            files_capped: files.capped,
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

    /// Bitbucket Cloud lists only the pull requests the user authored across repositories;
    /// it has no account-wide list of review requests.
    async fn mine(&self, http: &Http) -> Result<Vec<Listing<LaunchpadPull>>> {
        let missing = format!("No {LABEL} API found at {}", http.host());
        let user = http.call(Method::GET, "/user", None, &missing).await?;
        let account =
            http.decode::<Actor>(user)?
                .account_id
                .ok_or_else(|| PlatformError::AuthFailed {
                    host: http.host().to_owned(),
                    detail: "the server did not identify an account".to_owned(),
                })?;
        let first = format!(
            "/pullrequests/{}?state=OPEN&pagelen={PULL_PAGE}",
            encode(&account)
        );
        let listing = collect(first, |path| {
            let missing = missing.clone();
            async move {
                let page: Page<Pull> =
                    http.decode(http.call(Method::GET, &path, None, &missing).await?)?;
                Ok(Chunk {
                    items: page
                        .values
                        .into_iter()
                        .filter_map(|pull| {
                            let full = pull.destination.repository.as_ref()?.full_name.clone();
                            let (owner, repo) = full.split_once('/')?;
                            let repo = RepoRef {
                                owner: owner.to_owned(),
                                repo: repo.to_owned(),
                            };
                            let draft = pull.draft;
                            Some(LaunchpadPull {
                                connection_id: String::new(),
                                repo,
                                role: PullRole::Authored,
                                draft,
                                pull: pull.into(),
                                local_path: None,
                            })
                        })
                        .collect(),
                    total: page.size,
                    next: page.next.as_deref().and_then(|url| http.relative(url)),
                })
            }
        })
        .await?;
        Ok(vec![listing])
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
            owner: "owner".to_owned(),
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
            "links": {"html": {"href": "https://bitbucket.example/owner/widget/pull-requests/5"}}
        })
    }

    #[tokio::test]
    async fn cloud_mine_lists_the_pull_requests_the_user_authored_in_every_repository() {
        let fake = HttpFake::start(|request| {
            if request.path == "/2.0/user" {
                Reply::ok(r#"{"username":"yui","account_id":"acct-1"}"#)
            } else if request
                .path
                .starts_with("/2.0/pullrequests/acct-1?state=OPEN")
            {
                let mut pull = bitbucket_pull("OPEN");
                pull["draft"] = json!(true);
                pull["destination"]["repository"] = json!({"full_name": "owner/widget"});
                Reply::ok(&json!({"values": [pull]}).to_string())
            } else {
                Reply::status(404, "{}")
            }
        });

        let pulls = BitbucketCloud
            .mine(&http(&fake))
            .await
            .unwrap()
            .remove(0)
            .items;

        assert_eq!(pulls.len(), 1);
        assert_eq!(
            (pulls[0].repo.owner.as_str(), pulls[0].repo.repo.as_str()),
            ("owner", "widget")
        );
        assert_eq!(pulls[0].role, yforge_core::PullRole::Authored);
        assert!(pulls[0].draft);
        assert_eq!(pulls[0].pull.number, 5);
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
            .unwrap()
            .items;
        BitbucketCloud
            .list(&bitbucket, &repo(), PrFilter::All)
            .await
            .unwrap();

        let requests = fake.requests();
        assert_call(
            &requests[0],
            "GET",
            "/2.0/repositories/owner/widget/pullrequests?state=OPEN&pagelen=50",
        );
        assert_call(
            &requests[1],
            "GET",
            "/2.0/repositories/owner/widget/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&pagelen=50",
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
            "https://bitbucket.example/owner/widget/pull-requests/5"
        );
    }

    #[tokio::test]
    async fn cloud_detail_joins_the_pull_and_its_diffstat() {
        let fake = HttpFake::start(|request| {
            if request.path.contains("/diffstat") {
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
            "/2.0/repositories/owner/widget/pullrequests/5",
        );
        assert_call(
            &requests[1],
            "GET",
            "/2.0/repositories/owner/widget/pullrequests/5/diffstat?pagelen=500",
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
            "/2.0/repositories/owner/widget/pullrequests",
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
            "/2.0/repositories/owner/widget/pullrequests/5/merge",
        );
        assert_eq!(
            (created.state, merged.state),
            (PrState::Open, PrState::Merged)
        );
    }

    const CAP: usize = 1000;

    fn page_number(path: &str) -> usize {
        path.split(['?', '&'])
            .find_map(|part| part.strip_prefix("page="))
            .and_then(|value| value.parse().ok())
            .unwrap_or(1)
    }

    fn serve_pages(total: usize, size: bool, item: fn(usize) -> Value) -> HttpFake {
        HttpFake::start(move |request| {
            let page = page_number(&request.path);
            let per = 50;
            let start = ((page - 1) * per).min(total);
            let end = (start + per).min(total);
            let values: Vec<Value> = (start..end).map(item).collect();
            let mut body = json!({"values": values, "pagelen": per});
            if size {
                body["size"] = json!(total);
            }
            if end < total {
                let route = request.path.split('?').next().unwrap();
                let query: Vec<&str> = request
                    .path
                    .split_once('?')
                    .map_or("", |(_, query)| query)
                    .split('&')
                    .filter(|part| !part.starts_with("page="))
                    .collect();
                body["next"] = json!(format!(
                    "http://{}{route}?{}&page={}",
                    request.header("host").unwrap(),
                    query.join("&"),
                    page + 1
                ));
            }
            Reply::ok(&body.to_string())
        })
    }

    fn numbered_pull(id: usize) -> Value {
        let mut pull = bitbucket_pull("OPEN");
        pull["id"] = json!(id);
        pull
    }

    async fn listed(fake: &HttpFake) -> crate::paging::Listing<yforge_core::PullRequest> {
        BitbucketCloud
            .list(&http(fake), &repo(), PrFilter::Open)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn cloud_list_follows_the_next_links_and_reports_the_size() {
        let fake = serve_pages(120, true, numbered_pull);

        let list = listed(&fake).await;

        assert_eq!(fake.requests().len(), 3);
        assert_eq!(list.items.len(), 120);
        assert_eq!((list.total, list.capped), (Some(120), false));
    }

    #[tokio::test]
    async fn cloud_list_of_exactly_the_cap_is_not_capped() {
        let fake = serve_pages(CAP, true, numbered_pull);

        let list = listed(&fake).await;

        assert_eq!(list.items.len(), CAP);
        assert_eq!((list.total, list.capped), (Some(1000), false));
    }

    #[tokio::test]
    async fn cloud_list_over_the_cap_keeps_the_size_or_says_there_is_none() {
        let sized = listed(&serve_pages(1500, true, numbered_pull)).await;
        let unsized_fake = serve_pages(1500, false, numbered_pull);
        let unsized_list = listed(&unsized_fake).await;

        assert_eq!(sized.items.len(), CAP);
        assert_eq!((sized.total, sized.capped), (Some(1500), true));
        assert_eq!(unsized_list.items.len(), CAP);
        assert_eq!((unsized_list.total, unsized_list.capped), (None, true));
    }

    #[tokio::test]
    async fn cloud_files_follow_the_diffstat_pages() {
        let stat = |number: usize| {
            json!({"status": "modified", "lines_added": 1, "lines_removed": 0,
                   "old": {"path": format!("f{number}.rs")}, "new": {"path": format!("f{number}.rs")}})
        };
        let fake = HttpFake::start(move |request| {
            if request.path.contains("/diffstat") {
                let page = page_number(&request.path);
                let total = 620;
                let start = ((page - 1) * 500).min(total);
                let end = (start + 500).min(total);
                let values: Vec<Value> = (start..end).map(stat).collect();
                let mut body = json!({"values": values, "size": total});
                if end < total {
                    body["next"] = json!(format!(
                        "http://{}/2.0/repositories/owner/widget/pullrequests/5/diffstat?pagelen=500&page={}",
                        request.header("host").unwrap(),
                        page + 1
                    ));
                }
                Reply::ok(&body.to_string())
            } else {
                Reply::ok(&bitbucket_pull("OPEN").to_string())
            }
        });

        let detail = BitbucketCloud
            .detail(&http(&fake), &repo(), 5)
            .await
            .unwrap();

        assert_eq!(detail.files.len(), 620);
        assert_eq!(
            (detail.files_total, detail.files_capped),
            (Some(620), false)
        );
    }

    #[tokio::test]
    async fn cloud_mine_pages_the_authored_list() {
        let fake = HttpFake::start(|request| {
            if request.path == "/2.0/user" {
                return Reply::ok(r#"{"username":"yui","account_id":"acct-1"}"#);
            }
            let page = page_number(&request.path);
            let total = 70;
            let start = ((page - 1) * 50).min(total);
            let end = (start + 50).min(total);
            let values: Vec<Value> = (start..end)
                .map(|id| {
                    let mut pull = numbered_pull(id);
                    pull["destination"]["repository"] = json!({"full_name": "owner/widget"});
                    pull
                })
                .collect();
            let mut body = json!({"values": values, "size": total});
            if end < total {
                body["next"] = json!(format!(
                    "http://{}/2.0/pullrequests/acct-1?state=OPEN&pagelen=50&page={}",
                    request.header("host").unwrap(),
                    page + 1
                ));
            }
            Reply::ok(&body.to_string())
        });

        let mine = BitbucketCloud.mine(&http(&fake)).await.unwrap();

        assert_eq!(mine[0].items.len(), 70);
        assert_eq!((mine[0].total, mine[0].capped), (Some(70), false));
    }
}
