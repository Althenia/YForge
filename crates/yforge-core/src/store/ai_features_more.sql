CREATE TABLE ai_feature_config_next (
    feature TEXT PRIMARY KEY CHECK (feature IN ('generate_commit', 'recompose', 'conflict_fix', 'explain_changes', 'explain_commit', 'compose_commits', 'stash_message')),
    provider_id TEXT NOT NULL REFERENCES ai_providers (id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

INSERT INTO ai_feature_config_next (feature, provider_id, model_id, prompt_template, enabled)
SELECT feature, provider_id, model_id, prompt_template, enabled
FROM ai_feature_config
ORDER BY rowid;

DROP TABLE ai_feature_config;

ALTER TABLE ai_feature_config_next RENAME TO ai_feature_config;
