CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE repo_settings (
    repository TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (repository, key)
) WITHOUT ROWID;

CREATE TABLE recents (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    opened_at INTEGER NOT NULL
);

CREATE TABLE session (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active INTEGER NOT NULL
);

CREATE TABLE session_tabs (
    position INTEGER PRIMARY KEY,
    path TEXT NOT NULL
);

CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    operation TEXT NOT NULL,
    summary TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    succeeded INTEGER NOT NULL,
    is_local INTEGER NOT NULL,
    toast INTEGER NOT NULL,
    error TEXT,
    undo_kind TEXT NOT NULL CHECK (undo_kind IN ('available', 'unavailable', 'undone')),
    undo_detail TEXT
);

CREATE INDEX activity_by_repo ON activity (repo, id);

CREATE TABLE activity_commands (
    activity_id INTEGER NOT NULL REFERENCES activity (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    command TEXT NOT NULL,
    status INTEGER,
    duration_ms INTEGER NOT NULL,
    output TEXT NOT NULL,
    PRIMARY KEY (activity_id, position)
) WITHOUT ROWID;
