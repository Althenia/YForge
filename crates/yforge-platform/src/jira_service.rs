use std::path::Path;

use yforge_core::{
    jira_connection_add, jira_connection_remove, jira_connection_update, jira_connections_list,
    JiraConnection, JiraIssueList, JiraIssueLookup, JiraKind,
};

use crate::error::{PlatformError, Result};
use crate::http::scheme_for;
use crate::jira::JiraClient;
use crate::service::{keychain, valid_host, valid_token, PlatformService};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewJiraConnection {
    pub kind: JiraKind,
    pub site: String,
    pub email: Option<String>,
    pub token: String,
}

/// The problem the form must show with a field, or `None` when the value is acceptable.
pub fn jira_field_problem(field: &str, value: &str) -> Option<String> {
    let outcome = match field {
        "site" => valid_site(value).map(|_| ()),
        "email" => valid_email(value).map(|_| ()),
        "token" => valid_token(value).map(|_| ()),
        _ => return Some(format!("unknown field `{field}`")),
    };
    outcome.err().map(|error| error.detail())
}

fn account(id: &str) -> String {
    format!("jira.{id}")
}

fn valid_site(text: &str) -> Result<String> {
    let problem = || {
        PlatformError::invalid(
            "enter the site address, such as https://your-site.atlassian.net or https://jira.example.com",
        )
    };
    let text = text.trim();
    if text.is_empty() || text.contains(|c: char| c.is_whitespace() || matches!(c, '?' | '#' | '@'))
    {
        return Err(problem());
    }
    let (scheme, rest) = match text.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("https".to_owned(), text),
    };
    if !matches!(scheme.as_str(), "http" | "https") {
        return Err(problem());
    }
    let (authority, path) = rest.split_once('/').map_or((rest, ""), |(a, p)| (a, p));
    let authority = valid_host(authority).map_err(|_| problem())?;
    if scheme == "http" && scheme_for(&authority) != "http" {
        return Err(PlatformError::invalid(
            "Jira sites must use https:// so the token is never sent unencrypted",
        ));
    }
    let path = path.trim_end_matches('/');
    let path = if path.is_empty() {
        String::new()
    } else {
        format!("/{path}")
    };
    Ok(format!("{scheme}://{authority}{path}"))
}

fn valid_email(text: &str) -> Result<String> {
    let email = text.trim();
    let well_formed = email.split_once('@').is_some_and(|(name, domain)| {
        !name.is_empty() && !domain.is_empty() && !domain.contains('@')
    }) && !email.contains(char::is_whitespace);
    if !well_formed {
        return Err(PlatformError::invalid(
            "enter the email address of the Atlassian account that owns the API token",
        ));
    }
    Ok(email.to_owned())
}

fn project_of(key: &str) -> &str {
    key.split_once('-').map_or(key, |(project, _)| project)
}

impl PlatformService {
    pub fn jira_list(&self, dir: &Path) -> Result<Vec<JiraConnection>> {
        Ok(jira_connections_list(dir)?)
    }

    pub async fn jira_add(&self, dir: &Path, input: NewJiraConnection) -> Result<JiraConnection> {
        let site = valid_site(&input.site)?;
        let token = valid_token(&input.token)?;
        let email = match input.kind {
            JiraKind::Cloud => Some(valid_email(input.email.as_deref().unwrap_or_default())?),
            JiraKind::DataCenter => None,
        };
        let (name, projects) = JiraClient::new(input.kind, &site, email.as_deref(), &token, "")?
            .identify()
            .await?;
        let connection =
            jira_connection_add(dir, input.kind, &site, email.as_deref(), &name, &projects)?;
        if let Err(error) = self.secrets.set(&account(&connection.id), &token) {
            let _ = jira_connection_remove(dir, &connection.id);
            return Err(keychain(error));
        }
        Ok(connection)
    }

    pub fn jira_remove(&self, dir: &Path, id: &str) -> Result<()> {
        jira_connection_remove(dir, id)?;
        self.secrets.delete(&account(id)).map_err(keychain)
    }

    /// Checks the saved token and keeps the name and projects the site reports now.
    pub async fn jira_test(&self, dir: &Path, id: &str) -> Result<String> {
        let connection = self.jira_connection(dir, id)?;
        let (name, projects) = self.jira_client(&connection)?.identify().await?;
        jira_connection_update(dir, id, &name, &projects)?;
        Ok(name)
    }

    pub async fn jira_my_issues(&self, dir: &Path, id: &str) -> Result<JiraIssueList> {
        let connection = self.jira_connection(dir, id)?;
        let listing = self.jira_client(&connection)?.my_issues().await?;
        Ok(JiraIssueList {
            issues: listing.items,
            total: listing.total,
            capped: listing.capped,
        })
    }

    /// Looks each key up on the sites whose projects include it. A key no site knows, one the
    /// user cannot see, and one whose site failed all come back without an issue; only the
    /// last carries the failure.
    pub async fn jira_issues(&self, dir: &Path, keys: &[String]) -> Result<Vec<JiraIssueLookup>> {
        let mut lookups: Vec<JiraIssueLookup> = keys
            .iter()
            .map(|key| JiraIssueLookup {
                key: key.clone(),
                issue: None,
                failure: None,
            })
            .collect();
        for connection in jira_connections_list(dir)? {
            let wanted: Vec<&str> = keys
                .iter()
                .map(String::as_str)
                .filter(|key| {
                    connection
                        .projects
                        .iter()
                        .any(|project| project.key == project_of(key))
                })
                .collect();
            if wanted.is_empty() {
                continue;
            }
            let outcome = async { self.jira_client(&connection)?.issues(&wanted).await }.await;
            for lookup in lookups
                .iter_mut()
                .filter(|l| wanted.contains(&l.key.as_str()))
            {
                if lookup.issue.is_some() {
                    continue;
                }
                match &outcome {
                    Ok(found) => {
                        lookup.issue = found.iter().find(|issue| issue.key == lookup.key).cloned();
                        lookup.failure = None;
                    }
                    Err(error) => lookup.failure = Some(error.to_string()),
                }
            }
        }
        Ok(lookups)
    }

    fn jira_connection(&self, dir: &Path, id: &str) -> Result<JiraConnection> {
        self.jira_list(dir)?
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| PlatformError::invalid(format!("there is no Jira connection `{id}`")))
    }

    fn jira_client(&self, connection: &JiraConnection) -> Result<JiraClient> {
        let token = self
            .secrets
            .get(&account(&connection.id))
            .map_err(keychain)?
            .ok_or_else(|| PlatformError::AuthFailed {
                host: connection.host.clone(),
                detail: "no access token is stored for this connection".to_owned(),
            })?;
        JiraClient::new(
            connection.kind,
            &connection.site,
            connection.email.as_deref(),
            &token,
            &connection.id,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::valid_site;

    #[test]
    fn a_site_is_normalised_to_scheme_lower_case_host_and_path_without_a_trailing_slash() {
        for (input, expected) in [
            (
                "https://Your-Site.Atlassian.NET/",
                "https://your-site.atlassian.net",
            ),
            ("your-site.atlassian.net", "https://your-site.atlassian.net"),
            (
                "  HTTPS://jira.example.com:8443/Jira//  ",
                "https://jira.example.com:8443/Jira",
            ),
            ("http://127.0.0.1:9000", "http://127.0.0.1:9000"),
        ] {
            assert_eq!(valid_site(input).unwrap(), expected, "{input}");
        }
    }
}
