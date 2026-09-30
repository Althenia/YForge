CREATE TABLE ai_providers (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('chatgpt', 'claude_code', 'openrouter', 'openai_compatible')),
    name TEXT NOT NULL,
    base_url TEXT,
    model TEXT,
    executable_path TEXT,
    has_api_key INTEGER NOT NULL CHECK (has_api_key IN (0, 1)),
    created_at INTEGER NOT NULL
);
