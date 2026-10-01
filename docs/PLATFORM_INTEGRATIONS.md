# Platform Integrations: GitHub, GitLab, Bitbucket

Status: **approved 2026-09-30** (owner decision: in current scope; private servers, not just cloud; SSH; personal tokens)

## Scope

- **Platforms:** GitHub (cloud + GitHub Enterprise Server), GitLab (cloud + self-hosted), Bitbucket (Cloud + Data Center).
- **Authentication:** personal access tokens (PAT), stored in the macOS Keychain, never in the database. OAuth device flow stays post-MVP.
- **Git transport:** HTTPS and SSH both work. SSH uses the existing ssh-agent / key-path / askpass support; no new SSH machinery. Remote-URL parsing recognizes every URL form so a repo cloned over SSH matches its platform connection.
- **Features (this slice):**
  1. Connection management: add, list, test, remove a platform connection (kind, host, name, token, optional insecure-TLS flag).
  2. Pull request / merge request list for the open repository (matched through its remotes).
  3. PR detail: state, author, dates, mergeability, files with change counts.
  4. Create a PR from a local branch (source, target, title, body).
  5. Merge a PR, then fetch to update local refs.
- **Out of this slice:** OAuth, repo discovery for clone, CI checks, issues, comments, review approvals, Azure DevOps.

## Architecture

```
app/src-tauri (shell)
 �── yforge-platform (new crate: adapters, URL parsing, service)
        ├── yforge-core (unified model types, store: platform_connections table, error types)
       �── yforge-ai (SecretStore trait + KeychainStore, reused)
```

- **Model types** (`PlatformConnection`, `PullRequest`, `PullList`, `PrDetail`, `CreatePull`, `MatchedRepo`, `PlatformKind`, `PrState`, `PrFile`, `RepoRef`) live in `yforge-core` (`src/platform.rs`, following `src/ai.rs`) because the TS bindings are generated from `yforge-core` types via `crates/yforge-core/tests/bindings.rs` (`pnpm bindings`).
- **`yforge-platform`** owns the platform-specific logic: remote-URL parsing, the four HTTP adapters, and a `PlatformService` that resolves a repository path to a connection (via its remotes) and dispatches to the right adapter.
- **Connection rows** (non-secret) live in the app store: new migration `platform_connections.sql` (id, kind, host, name, insecure_tls, created_at), CRUD in `store/platform.rs` following the `store/ai.rs` pattern.
- **Tokens** live in the Keychain under account `platform.<connection-id>`, through the existing `SecretStore` trait (`yforge-ai::secret`). The shell already constructs a `KeychainStore`; it passes the same `Arc<dyn SecretStore>` to the platform service.
- **HTTP:** `reqwest` (already a workspace dependency), one client per request batch, 30 s timeout. `insecure_tls` (default `false`) maps to `danger_accept_invalid_certs` for self-hosted servers with self-signed certificates; the UI states the risk.

## Unified model

```rust
pub enum PlatformKind { GitHub, GitLab, Bitbucket }   // wire values: "github" | "gitlab" | "bitbucket", TS derive

pub struct PlatformConnection {
    pub id: String,
    pub kind: PlatformKind,
    pub host: String,        // github.com, gitlab.com, ghe.example.com — no scheme
    pub name: String,        // display name
    pub insecure_tls: bool,
    pub created_at: i64,
}

pub struct RepoRef { pub owner: String, pub repo: String }

pub enum PrState { Open, Merged, Closed }

pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub body: String,
    pub state: PrState,
    pub source_ref: String,
    pub target_ref: String,
    pub author: String,
    pub created_at: String,  // RFC 3339
    pub updated_at: String,
    pub mergeable: Option<bool>,
    pub web_url: String,
}

pub struct PrFile {
    pub filename: String,
    pub status: String,      // added | modified | removed | renamed
    pub additions: i64,
    pub deletions: i64,
}

pub struct PullList { pub pulls: Vec<PullRequest>, pub total: Option<u32>, pub capped: bool }

pub struct PrDetail { pub pull: PullRequest, pub files: Vec<PrFile>, pub files_total: Option<u32>, pub files_capped: bool }

pub struct CreatePull {
    pub source_ref: String,
    pub target_ref: String,
    pub title: String,
    pub body: String,
}

pub struct MatchedRepo {
    pub connection: PlatformConnection,
    pub remote: String,      // remote name the match came from
    pub repo: RepoRef,
}
```

All types derive `Serialize, Deserialize, TS` for the bindings.

## Remote-URL parsing and matching

`parse_remote(url) -> Option<(host, RepoRef)>` handles, case-insensitive host, `.git` suffix stripped:

- `https://host/owner/repo.git`, `http://…`
- `git@host:owner/repo.git`
- `ssh://git@host/owner/repo.git`
- `git://host/owner/repo.git`
- Bitbucket Data Center: `https://host/scm/PROJECT/repo.git` and `ssh://git@host:7999/scm/PROJECT/repo.git` (a leading `/scm/` segment is dropped; owner = project key, repo = slug), and browse URLs `https://host/projects/PROJECT/repos/repo[/…]`.

A connection matches a remote when the hosts are equal (case-insensitive). `match_repo(path)` reads the repository's remotes (`git remote`) and returns the first `MatchedRepo` (remote order from `git remote`). No match → the UI shows no PR section; it is not an error.

## Adapters

One trait, four implementations (GitHub, GitLab, Bitbucket Cloud, Bitbucket Data Center). All requests carry `Authorization: Bearer <token>`.

Bitbucket routing: host `bitbucket.org` → Cloud (2.0 API); any other host → Data Center (1.0 API).

| | GitHub | GitLab |
|---|---|---|
| Base | `https://api.github.com` for `github.com`; `https://host/api/v3` for GitHub Enterprise Server | `https://host/api/v4` |
| Extra header | `Accept: application/vnd.github+json` | — |
| Verify | `GET /user` → `login` | `GET /user` → `username` |
| List | `GET /repos/{o}/{r}/pulls?state=open&per_page=100&page=n` (a full page means another may follow) | `GET /projects/{urlencoded o/r}/merge_requests?state=opened&per_page=100&page=n` (`X-Next-Page`; `X-Total` is the total) |
| Detail | `GET /repos/{o}/{r}/pulls/{n}` + `GET …/pulls/{n}/files?per_page=100&page=n` (`files_total` is the pull's `changed_files`) | `GET /projects/{id}/merge_requests/{iid}` — the response includes a `changes[]` array with per-file diffs (`new_path`, `new_file`, `renamed_file`, `deleted_file`) in one response, cut by the service (`overflow`, or a `changes_count` ending in `+`) and by the 1,000 cap; if absent, files = empty list and the detail still works |
| Create | `POST /repos/{o}/{r}/pulls` `{title, head, base, body}` | `POST /projects/{id}/merge_requests` `{source_branch, target_branch, title, description}` |
| Merge | `PUT /repos/{o}/{r}/pulls/{n}/merge` | `PUT /projects/{id}/merge_requests/{iid}/merge` |

| | Bitbucket Cloud | Bitbucket Data Center |
|---|---|---|
| Base | `https://api.bitbucket.org/2.0` | `https://host/rest/api/1.0` |
| Verify | `GET /user` → `username` | `GET /application-properties`; the username is the `X-AUSERNAME` response header (Data Center has no current-user endpoint); a missing header → `auth_failed` |
| List | `GET /repositories/{o}/{r}/pullrequests?state=OPEN&pagelen=50`, then the `next` link (`size` is the total when sent) | `GET /projects/{key}/repos/{slug}/pull-requests?state=OPEN&limit=100&start=n` (`state=ALL` for all) → `values[]`, until `isLastPage`, continuing at `nextPageStart` |
| Detail | `GET /repositories/{o}/{r}/pullrequests/{id}` + `GET …/pullrequests/{id}/diffstat?pagelen=500`, then the `next` link (`size` is the file total) | `GET /projects/{key}/repos/{slug}/pull-requests/{id}` + `GET …/pull-requests/{id}/diff` (a `truncated` diff is capped; `files_total` is the file count only when it is not truncated; `diffs[]`; per-file additions/deletions = lines in `ADDED`/`REMOVED` segments; `source` null → added, `destination` null → removed, differing paths → renamed) |
| Create | `POST /repositories/{o}/{r}/pullrequests` `{title, description, source:{branch:{name}}, destination:{branch:{name}}}` | `POST /projects/{key}/repos/{slug}/pull-requests` `{title, description, fromRef:{id:"refs/heads/<branch>", repository:{slug, project:{key}}}, toRef:{…}}` |
| Merge | `POST /repositories/{o}/{r}/pullrequests/{id}/merge` | `GET …/pull-requests/{id}` for `version`, then `POST …/pull-requests/{id}/merge?version={version}` |

In Data Center, owner = project key and repo = repository slug.

Field mapping (source → unified):

- GitHub: `number, title, body, state + merged_at → state, head.ref, base.ref, user.login, created_at, updated_at, mergeable, html_url`.
- GitLab: `iid, title, description, state (opened|merged|closed), source_branch, target_branch, author.username, created_at, updated_at, merge_status == "can_merge" → mergeable, web_url`.
- Bitbucket Cloud: `id, title, description, state (OPEN|MERGED|REJECTED), source.branch.name, destination.branch.name, author.username, created_on, updated_on, mergeable = (state == OPEN), links.html.href`.
- Bitbucket Data Center: `id, title, description, state (OPEN|MERGED|DECLINED), fromRef.displayId, toRef.displayId, author.user.name, createdDate and updatedDate (epoch milliseconds → RFC 3339 UTC), mergeable = (state == OPEN), links.self[0].href`.

## Paged lists (rule S44)

Every list read from a platform follows the service's pagination to the end, up to a safety cap of 1,000 items (`LIST_CAP`, `crates/yforge-platform/src/paging.rs`). Each list carries `total: number | null` (the true total when the service reports one, else the items returned when not capped, else `null`) and `capped: boolean` (the service has more than the 1,000 returned). A request that fails fails the whole list. The per-command paging and the source of each total are in `docs/CORE_UI_CONTRACT.md`, section "Paged lists".

The UI counts the true total, never the array length: the sidebar pull request count, `Files · N` in the pull request inspector, the Launchpad tab counts, and the Jira issue count. A capped list says so in text: "Showing 1,000 of <total>", or "Showing the first 1,000" when `total` is `null`. When a pull request's files are capped, the inspector also states that the +/- sums cover only the loaded files.

## Errors

`PlatformError` kinds, surfaced through the core `ErrorPayload` contract:

- `auth_failed` — 401/403. Message: `Authentication failed for <host>`. UI offers "Edit connection" (fix the token).
- `not_found` — 404 on verify/list. Message: `No <platform> repository found for <owner>/<repo>` (covers wrong host and missing access).
- `api_error` — other non-2xx, with status and the platform's message.
- `network` — DNS, timeout, TLS. Message names the host.
- `invalid_request` — bad connection input (host format, empty token, name 1–80 chars).

## Tauri commands

| Command | Args | Returns |
|---|---|---|
| `platform_connections_list` | — | `Vec<PlatformConnection>` |
| `platform_connection_add` | `kind, host, name, token, insecure_tls` | `PlatformConnection` (validates input, tests the token, stores row + Keychain entry; rolls back on test failure) |
| `platform_connection_remove` | `id` | `null` (removes row + Keychain entry) |
| `platform_connection_test` | `id` | `String` (the verified login name) |
| `platform_repo_match` | `path` | `Option<MatchedRepo>` |
| `platform_prs_list` | `path, state: "open" \| "all"` | `PullList { pulls, total, capped }` |
| `platform_pr_detail` | `path, number` | `PrDetail { pull, files, files_total, files_capped }` |
| `platform_pr_create` | `path, CreatePull` | `PullRequest` |
| `platform_pr_merge` | `path, number` | `PullRequest` |

`platform_pr_merge` returns after the API merge succeeds; the frontend then runs the existing `fetch` command to update local refs.

## Frontend

- **Settings → Platforms:** list of connections (kind glyph, name, host); add dialog (kind, host, name, token, insecure-TLS checkbox with a plain-language warning); per-row Test and Remove. Token field is write-only: editing a connection re-tests with a new token.
- **Workspace sidebar → Pull requests section:** visible only when `platform_repo_match` resolves. Lists open PRs: `#number title`, author, `source → target`; the section count is `PullList.total` (or the number returned), with the capped text under the list when `capped`. Row actions: open in browser, merge (confirm dialog stating the consequence), and a section-level "New pull request" action.
- **PR detail view:** state, author, dates, mergeability, `Files · <files_total or files shown>`, the file list with +/- counts (and, when only part of the files was loaded, a text note that the sums cover only the loaded files); open in browser.
- **Create PR dialog:** source (default: current branch), target (default: the remote's default branch), title (default: HEAD subject), body. On success: toast with the web URL, list refreshes.
- **Merge:** confirm → `platform_pr_merge` → `fetch` → toast; the PR row moves to merged state on refresh.
- Query keys: `["platform", "match", path]`, `["platform", "prs", path, state]`, `["platform", "pr", path, number]`. Mutations invalidate the list.

## Jira and the Launchpad (rules S39 and S41)

- **Connections:** `jira_connections` (migration 9) keeps kind (`cloud` or `data_center`), the site address, the Cloud email, the display name, and the visible project list (refreshed on connect and Test). The token lives only in the Keychain under `jira.<id>`. Cloud signs in with Basic (email and API token) against `/rest/api/3`, Data Center with a Bearer personal access token against `/rest/api/2`. YForge only issues `GET` requests to Jira.
- **Reads:** `GET /myself` (display name), Cloud `GET /project/search?startAt&maxResults` (paged until `isLast`) or Data Center `GET /project`, Cloud `GET /search/jql` (`maxResults=100`, `nextPageToken`) or Data Center `GET /search` (`maxResults=100&startAt=n`, `total`) with `jql=assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC` (my issues, returned as `JiraIssueList { issues, total, capped }`, at most 1,000) or `key in (…)` (chip lookups, 50 keys per request), `fields=summary,status,issuetype,project,updated`.
- **Issue keys:** `[A-Z][A-Z0-9]+-\d+`, case-sensitive, not glued to letters or digits, kept only when the project belongs to a connected site; branch names, commit subjects and messages, and pull request titles.
- **My pull requests:** per connection, GitHub `GET /search/issues?q=is:pr is:open author:@me` and `review-requested:@me` then `GET /repos/{o}/{r}/pulls/{n}` for the branches; GitLab `GET /merge_requests?state=opened&scope=created_by_me` and `scope=all&reviewer_username=<user>`; Bitbucket Data Center `GET /dashboard/pull-requests?state=OPEN&role=AUTHOR|REVIEWER`; Bitbucket Cloud `GET /pullrequests/{account_id}?state=OPEN` (authored only: the API has no account-wide review list). Each role is paged and merged into `LaunchpadPulls { pulls, total, capped }`, at most 1,000. The Launchpad states each source's own update time ("<source> · updated <age> ago"), never one combined time.
- **Query keys:** `["jira", "connections"]`, `["jira", "issues", id]`, `["jira", "keys", texts]`, `["jira", "lookup", keys]`, `["launchpad", "pulls", id]`, `["launchpad", "wips"]`.

## Design process

New UI follows the standing rules: `DESIGN.md` / `app/DESIGN.md` rules start as `proposal`, both strict lints run, a specimen is added for the PR panel (next free screen number) plus the settings Platforms section, renders are produced, `scripts/sync-yds.sh` runs.

## Verification

- **Unit:** URL parsing (every URL form including Data Center `/scm/` and `/projects/…/repos/…`, `.git` suffix, case, rejection of local paths); each adapter against a fake `TcpListener` HTTP server asserting method, path, headers, and mapping (the `yforge-ai` test pattern); service matching (remote order, no match, multiple remotes).
- **Store:** connection CRUD round-trip, migration bump.
- **Shell:** IPC tests with a fake server for add/test/list/create/merge, including `auth_failed` and `not_found` mapping.
- **Runtime:** a local fake platform server on `127.0.0.1` (self-hosted path) driven through the debug bundle: add connection → list → detail → create → merge → fetch; plus a real `github.com` connection test if a token is available (verify + list on a public repo).
- **Checks:** `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm bindings`, `pnpm typecheck`, `pnpm test`, `pnpm build`, both strict `design_md.py` lints.
