mod adapter;
mod bitbucket_cloud;
mod bitbucket_data_center;
mod checks;
mod client;
mod error;
#[cfg(test)]
#[path = "../tests/common/mod.rs"]
mod fake;
mod github;
mod gitlab;
mod http;
mod jira;
mod jira_service;
pub mod oauth;
mod paging;
mod service;
mod timestamp;
mod url;

pub use adapter::PrFilter;
pub use client::Client;
pub use error::{PlatformError, Result};
pub use jira_service::{jira_field_problem, NewJiraConnection};
pub use oauth::{OAuthEndpoints, OAuthRecord};
pub use service::{
    connection_field_problem, oauth_field_problem, NewConnection, NewOAuthConnection,
    PlatformService,
};
pub use url::parse_remote;
pub use yforge_core::{PlatformOAuthMethod, PlatformOAuthStage, PlatformSignInEvent};
