CREATE TABLE ai_providers_next (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('chatgpt', 'claude', 'openrouter', 'openai_compatible')),
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('api_key', 'subscription')),
    name TEXT NOT NULL,
    base_url TEXT,
    model TEXT,
    has_api_key INTEGER NOT NULL CHECK (has_api_key IN (0, 1)),
    created_at INTEGER NOT NULL,
    CHECK (auth_mode = 'api_key' OR kind IN ('chatgpt', 'claude'))
);

INSERT INTO ai_providers_next (seq, id, kind, auth_mode, name, base_url, model, has_api_key, created_at)
SELECT
    seq,
    id,
    CASE kind WHEN 'claude_code' THEN 'claude' ELSE kind END,
    CASE WHEN kind IN ('chatgpt', 'claude_code') THEN 'subscription' ELSE 'api_key' END,
    name,
    base_url,
    model,
    has_api_key,
    created_at
FROM ai_providers;

DROP TABLE ai_providers;

ALTER TABLE ai_providers_next RENAME TO ai_providers;

CREATE TABLE ai_feature_config (
    feature TEXT PRIMARY KEY CHECK (feature IN ('generate_commit', 'recompose', 'conflict_fix')),
    provider_id TEXT NOT NULL REFERENCES ai_providers (id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    prompt_template TEXT NOT NULL
);
