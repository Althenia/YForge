use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AiError, Result};
use crate::http::{send, Body, Request};
use crate::limits::Limits;

pub const LABEL: &str = "Claude";
pub const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
pub const SIGN_IN_FIRST: &str = "Sign in to Claude Code first";
const EXPIRY_BUFFER_MS: i64 = 60_000;
const DEFAULT_LIFETIME_SECONDS: i64 = 36_000;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

impl Credentials {
    pub fn expired(&self, now_ms: i64) -> bool {
        self.expires_at - EXPIRY_BUFFER_MS <= now_ms
    }
}

pub fn parse(raw: &str) -> Option<Credentials> {
    let root: Value = serde_json::from_str(raw).ok()?;
    let value = root.get("claudeAiOauth").unwrap_or(&root);
    let access_token = value.get("accessToken")?.as_str()?.trim();
    if access_token.is_empty() {
        return None;
    }
    Some(Credentials {
        access_token: access_token.to_owned(),
        refresh_token: value.get("refreshToken")?.as_str()?.to_owned(),
        expires_at: value.get("expiresAt")?.as_f64()? as i64,
    })
}

pub fn freshest(cached: Option<Credentials>, external: Option<Credentials>) -> Option<Credentials> {
    match (cached, external) {
        (Some(cached), Some(external)) => Some(if cached.expires_at >= external.expires_at {
            cached
        } else {
            external
        }),
        (cached, external) => cached.or(external),
    }
}

pub fn auth_required() -> AiError {
    AiError::AuthRequired {
        provider: LABEL.to_owned(),
        detail: SIGN_IN_FIRST.to_owned(),
    }
}

pub async fn refresh(
    token_url: &str,
    previous: &Credentials,
    now_ms: i64,
    limits: &Limits,
) -> Result<Credentials> {
    let request = Request::post(
        LABEL,
        token_url.to_owned(),
        Body::Form(vec![
            ("grant_type", "refresh_token".to_owned()),
            ("client_id", CLIENT_ID.to_owned()),
            ("refresh_token", previous.refresh_token.clone()),
        ]),
    );
    let reply = send(request, limits.status, None).await?;
    if reply.status.is_client_error() {
        return Err(AiError::AuthRequired {
            provider: LABEL.to_owned(),
            detail: "the Claude Code sign-in expired; sign in to Claude Code again".to_owned(),
        });
    }
    let text = reply.success()?;
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: LABEL.to_owned(),
        reason: reason.to_owned(),
    };
    let value: Value =
        serde_json::from_str(&text).map_err(|_| invalid("the token reply is not JSON"))?;
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| invalid("the token reply has no access token"))?;
    let lifetime = value
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_LIFETIME_SECONDS);
    Ok(Credentials {
        access_token: access_token.to_owned(),
        refresh_token: value
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or(&previous.refresh_token)
            .to_owned(),
        expires_at: now_ms.saturating_add(lifetime.saturating_mul(1000)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credentials(expires_at: i64, access: &str) -> Credentials {
        Credentials {
            access_token: access.to_owned(),
            refresh_token: "r".to_owned(),
            expires_at,
        }
    }

    #[test]
    fn the_keychain_blob_is_read_from_claude_ai_oauth_or_the_root() {
        let nested = r#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":1790000000000,"subscriptionType":"max"},"mcpOAuth":{}}"#;
        let flat = r#"{"accessToken":"a","refreshToken":"r","expiresAt":5}"#;

        assert_eq!(parse(nested), Some(credentials(1_790_000_000_000, "a")));
        assert_eq!(parse(flat), Some(credentials(5, "a")));
    }

    #[test]
    fn incomplete_or_unreadable_blobs_are_not_credentials() {
        for raw in [
            "",
            "not json",
            "{}",
            r#"{"claudeAiOauth":{"accessToken":"  ","refreshToken":"r","expiresAt":1}}"#,
            r#"{"claudeAiOauth":{"accessToken":"a","expiresAt":1}}"#,
            r#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":"soon"}}"#,
        ] {
            assert_eq!(parse(raw), None, "{raw}");
        }
    }

    #[test]
    fn the_later_expiry_wins_between_the_cache_and_claude_code() {
        let newer = credentials(200, "new");
        let older = credentials(100, "old");

        assert_eq!(
            freshest(Some(older.clone()), Some(newer.clone())),
            Some(newer.clone())
        );
        assert_eq!(
            freshest(Some(newer.clone()), Some(older)),
            Some(newer.clone())
        );
        assert_eq!(freshest(None, Some(newer.clone())), Some(newer));
        assert_eq!(freshest(None, None), None);
    }
}
