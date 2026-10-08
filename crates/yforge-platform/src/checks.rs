use reqwest::Method;
use serde_json::Value;
use yforge_core::{PullChecks, RepoRef};

use crate::client::Api;
use crate::error::{PlatformError, Result};
use crate::http::{encode, Http};

fn count(summary: &mut PullChecks, state: &str) {
    match state {
        "success" | "successful" | "neutral" | "skipped" => summary.passing += 1,
        "failure" | "failed" | "error" | "cancelled" | "canceled" | "timed_out"
        | "action_required" | "stopped" => summary.failing += 1,
        _ => summary.pending += 1,
    }
}

fn finish(summary: PullChecks) -> Option<PullChecks> {
    (summary.passing + summary.failing + summary.pending > 0 || summary.capped).then_some(summary)
}

pub(crate) async fn read(
    http: &Http,
    api: Api,
    repo: &RepoRef,
    number: i64,
) -> Result<Option<PullChecks>> {
    if number <= 0 {
        return Err(PlatformError::invalid(
            "pull request number must be positive",
        ));
    }
    let owner = encode(&repo.owner);
    let name = encode(&repo.repo);
    let mut summary = PullChecks::default();
    let get = |path: String| async move {
        http.call(
            Method::GET,
            &path,
            None,
            "Pull request checks are unavailable",
        )
        .await
    };
    match api {
        Api::GitHub => {
            let pull = get(format!("/repos/{owner}/{name}/pulls/{number}")).await?;
            if pull["state"] != "open" {
                return Ok(None);
            }
            let sha = pull
                .pointer("/head/sha")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    PlatformError::invalid("GitHub did not report the pull request head commit")
                })?;
            let prefix = format!("/repos/{owner}/{name}/commits/{}", encode(sha));
            let runs = get(format!("{prefix}/check-runs?per_page=100&filter=latest")).await?;
            let statuses = get(format!("{prefix}/status?per_page=100")).await?;
            for (value, field) in [(&runs, "check_runs"), (&statuses, "statuses")] {
                let entries = value[field]
                    .as_array()
                    .ok_or_else(|| PlatformError::invalid("GitHub returned invalid checks"))?;
                summary.capped |= value["total_count"]
                    .as_u64()
                    .map_or(entries.len() >= 100, |total| {
                        total > entries.len().min(100) as u64
                    })
                    || entries.len() > 100;
                for entry in entries.iter().take(100) {
                    let state = if field == "statuses" {
                        entry["state"].as_str()
                    } else if entry["status"] == "completed" {
                        entry["conclusion"].as_str()
                    } else {
                        Some("pending")
                    };
                    count(&mut summary, state.unwrap_or("pending"));
                }
            }
        }
        Api::GitLab => {
            let project = encode(&format!("{}/{}", repo.owner, repo.repo));
            let pull = get(format!("/projects/{project}/merge_requests/{number}")).await?;
            if pull["state"] != "opened" {
                return Ok(None);
            }
            if let Some(state) = pull
                .pointer("/head_pipeline/status")
                .and_then(Value::as_str)
            {
                count(&mut summary, state);
            }
        }
        Api::BitbucketCloud => {
            let statuses = get(format!(
                "/repositories/{owner}/{name}/pullrequests/{number}/statuses?pagelen=100"
            ))
            .await?;
            let entries = statuses["values"]
                .as_array()
                .ok_or_else(|| PlatformError::invalid("Bitbucket returned invalid checks"))?;
            summary.capped = statuses["next"].as_str().is_some() || entries.len() > 100;
            for entry in entries.iter().take(100) {
                count(
                    &mut summary,
                    &entry["state"]
                        .as_str()
                        .unwrap_or("pending")
                        .to_ascii_lowercase(),
                );
            }
        }
        Api::BitbucketDataCenter => {
            let pull = get(format!(
                "/projects/{owner}/repos/{name}/pull-requests/{number}"
            ))
            .await?;
            if pull["state"] != "OPEN" {
                return Ok(None);
            }
            let sha = pull
                .pointer("/fromRef/latestCommit")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    PlatformError::invalid("Bitbucket did not report the pull request head commit")
                })?;
            let stats = match get(format!(
                "/../../build-status/1.0/commits/stats/{}",
                encode(sha)
            ))
            .await
            {
                Err(PlatformError::NotFound { .. }) => return Ok(None),
                other => other?,
            };
            let value = |field: &str| -> Result<u32> {
                stats[field]
                    .as_u64()
                    .and_then(|count| count.try_into().ok())
                    .ok_or_else(|| {
                        PlatformError::invalid("Bitbucket returned invalid build counts")
                    })
            };
            summary.passing = value("successful")?;
            summary.failing = value("failed")?;
            summary.pending = value("inProgress")?;
        }
    }
    Ok(finish(summary))
}
