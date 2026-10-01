use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{open, sql, state_path};
use crate::ai::{AiFeature, AiFeatureConfig, AuthMode, ProviderConfig, ProviderKind};
use crate::error::CoreError;
use crate::sqlite::{failure, unix_now};

const COLUMNS: &str = "id, kind, auth_mode, name, base_url, has_api_key, created_at";
const FEATURE_COLUMNS: &str = "feature, provider_id, model_id, prompt_template, enabled";

type StoredProvider = (String, String, ProviderConfig);

fn read_row(row: &Row<'_>) -> rusqlite::Result<StoredProvider> {
    let kind: String = row.get(1)?;
    let auth_mode: String = row.get(2)?;
    let config = ProviderConfig {
        id: row.get(0)?,
        kind: ProviderKind::Chatgpt,
        auth_mode: AuthMode::ApiKey,
        name: row.get(3)?,
        base_url: row.get(4)?,
        has_api_key: row.get(5)?,
        created_at: row.get(6)?,
    };
    Ok((kind, auth_mode, config))
}

fn decode(
    dir: &Path,
    (kind, auth_mode, mut config): StoredProvider,
) -> Result<ProviderConfig, CoreError> {
    config.kind = ProviderKind::parse(&kind).ok_or_else(|| {
        failure(
            &state_path(dir),
            format!("AI provider {} has an unknown kind `{kind}`", config.id),
        )
    })?;
    config.auth_mode = AuthMode::parse(&auth_mode).ok_or_else(|| {
        failure(
            &state_path(dir),
            format!(
                "AI provider {} has an unknown auth mode `{auth_mode}`",
                config.id
            ),
        )
    })?;
    Ok(config)
}

fn check_mode(kind: ProviderKind, auth_mode: AuthMode) -> Result<(), CoreError> {
    if auth_mode == AuthMode::Subscription && !kind.supports_subscription() {
        return Err(CoreError::invalid_request(format!(
            "{} takes an API key only",
            kind.label()
        )));
    }
    Ok(())
}

fn find(conn: &Connection, id: &str) -> rusqlite::Result<Option<StoredProvider>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM ai_providers WHERE id = ?1"),
        [id],
        read_row,
    )
    .optional()
}

fn missing(id: &str) -> CoreError {
    CoreError::invalid_request(format!("there is no AI provider `{id}`"))
}

fn fresh_id(conn: &Connection, kind: ProviderKind) -> rusqlite::Result<String> {
    let mut stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    loop {
        let id = format!("{}-{stamp:x}", kind.as_str());
        if find(conn, &id)?.is_none() {
            return Ok(id);
        }
        stamp += 1;
    }
}

pub fn ai_providers(dir: &Path) -> Result<Vec<ProviderConfig>, CoreError> {
    let conn = open(dir)?;
    let rows = conn
        .prepare(&format!("SELECT {COLUMNS} FROM ai_providers ORDER BY seq"))
        .and_then(|mut statement| {
            statement
                .query_map([], read_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))?;
    rows.into_iter().map(|row| decode(dir, row)).collect()
}

pub fn ai_provider(dir: &Path, id: &str) -> Result<ProviderConfig, CoreError> {
    let conn = open(dir)?;
    match find(&conn, id).map_err(sql(dir))? {
        Some(row) => decode(dir, row),
        None => Err(missing(id)),
    }
}

pub fn ai_provider_add(
    dir: &Path,
    kind: ProviderKind,
    auth_mode: AuthMode,
    name: &str,
    base_url: Option<&str>,
) -> Result<ProviderConfig, CoreError> {
    check_mode(kind, auth_mode)?;
    let conn = open(dir)?;
    let id = fresh_id(&conn, kind).map_err(sql(dir))?;
    let created_at = unix_now();
    conn.execute(
        "INSERT INTO ai_providers (id, kind, auth_mode, name, base_url, has_api_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        params![
            id,
            kind.as_str(),
            auth_mode.as_str(),
            name,
            base_url,
            created_at
        ],
    )
    .map_err(sql(dir))?;
    Ok(ProviderConfig {
        id,
        kind,
        auth_mode,
        name: name.to_owned(),
        base_url: base_url.map(str::to_owned),
        has_api_key: false,
        created_at,
    })
}

pub fn ai_provider_edit(
    dir: &Path,
    id: &str,
    auth_mode: AuthMode,
    name: &str,
    base_url: Option<&str>,
) -> Result<ProviderConfig, CoreError> {
    check_mode(ai_provider(dir, id)?.kind, auth_mode)?;
    let conn = open(dir)?;
    let changed = conn
        .execute(
            "UPDATE ai_providers SET auth_mode = ?2, name = ?3, base_url = ?4 WHERE id = ?1",
            params![id, auth_mode.as_str(), name, base_url],
        )
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    ai_provider(dir, id)
}

pub fn ai_provider_key_flag(dir: &Path, id: &str, has_api_key: bool) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute(
            "UPDATE ai_providers SET has_api_key = ?2 WHERE id = ?1",
            params![id, has_api_key],
        )
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    Ok(())
}

pub fn ai_provider_delete(dir: &Path, id: &str) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute("DELETE FROM ai_providers WHERE id = ?1", [id])
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    Ok(())
}

type FeatureRow = (String, String, String, String, bool);

fn feature_row(row: &Row<'_>) -> rusqlite::Result<FeatureRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}

fn feature_decode(
    dir: &Path,
    (feature, provider_id, model_id, prompt_template, enabled): FeatureRow,
) -> Result<(AiFeatureConfig, bool), CoreError> {
    let feature = AiFeature::parse(&feature).ok_or_else(|| {
        failure(
            &state_path(dir),
            format!("AI feature config has an unknown feature `{feature}`"),
        )
    })?;
    let config = AiFeatureConfig {
        feature,
        provider_id,
        model_id,
        prompt_template,
    };
    Ok((config, enabled))
}

/// Every saved feature configuration with whether the feature is switched on.
pub fn ai_feature_configs(dir: &Path) -> Result<Vec<(AiFeatureConfig, bool)>, CoreError> {
    let conn = open(dir)?;
    let rows = conn
        .prepare(&format!(
            "SELECT {FEATURE_COLUMNS} FROM ai_feature_config ORDER BY rowid"
        ))
        .and_then(|mut statement| {
            statement
                .query_map([], feature_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))?;
    rows.into_iter()
        .map(|row| feature_decode(dir, row))
        .collect()
}

pub fn ai_feature_config(
    dir: &Path,
    feature: AiFeature,
) -> Result<Option<(AiFeatureConfig, bool)>, CoreError> {
    let row = open(dir)?
        .query_row(
            &format!("SELECT {FEATURE_COLUMNS} FROM ai_feature_config WHERE feature = ?1"),
            [feature.as_str()],
            feature_row,
        )
        .optional()
        .map_err(sql(dir))?;
    row.map(|row| feature_decode(dir, row)).transpose()
}

pub fn ai_feature_config_set(dir: &Path, config: &AiFeatureConfig) -> Result<(), CoreError> {
    let conn = open(dir)?;
    if find(&conn, &config.provider_id)
        .map_err(sql(dir))?
        .is_none()
    {
        return Err(missing(&config.provider_id));
    }
    conn.execute(
        "INSERT INTO ai_feature_config (feature, provider_id, model_id, prompt_template, enabled)
         VALUES (?1, ?2, ?3, ?4, 1)
         ON CONFLICT (feature) DO UPDATE SET
             provider_id = excluded.provider_id,
             model_id = excluded.model_id,
             prompt_template = excluded.prompt_template",
        params![
            config.feature.as_str(),
            config.provider_id,
            config.model_id,
            config.prompt_template
        ],
    )
    .map(drop)
    .map_err(sql(dir))
}

pub fn ai_feature_config_enable(
    dir: &Path,
    feature: AiFeature,
    enabled: bool,
) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute(
            "UPDATE ai_feature_config SET enabled = ?2 WHERE feature = ?1",
            params![feature.as_str(), enabled],
        )
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(CoreError::invalid_request(format!(
            "{} has no saved provider and model",
            feature.title()
        )));
    }
    Ok(())
}

pub fn ai_feature_config_reset(dir: &Path, feature: AiFeature) -> Result<(), CoreError> {
    open(dir)?
        .execute(
            "DELETE FROM ai_feature_config WHERE feature = ?1",
            [feature.as_str()],
        )
        .map(drop)
        .map_err(sql(dir))
}
