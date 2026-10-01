ALTER TABLE ai_providers DROP COLUMN model;

ALTER TABLE ai_feature_config ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

DELETE FROM settings WHERE key = 'ai.active_provider';
