mod adapter;
mod bitbucket_cloud;
mod bitbucket_data_center;
mod client;
mod error;
#[cfg(test)]
#[path = "../tests/common/mod.rs"]
mod fake;
mod github;
mod gitlab;
mod http;
mod service;
mod timestamp;
mod url;

pub use adapter::PrFilter;
pub use client::Client;
pub use error::{PlatformError, Result};
pub use service::{NewConnection, PlatformService};
pub use url::parse_remote;
