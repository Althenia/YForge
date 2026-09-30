CREATE TABLE crashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at INTEGER NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('rust', 'frontend')),
    kind TEXT NOT NULL,
    app_version TEXT NOT NULL,
    os TEXT NOT NULL,
    arch TEXT NOT NULL,
    thread TEXT,
    message TEXT NOT NULL,
    location TEXT,
    stack TEXT,
    view TEXT
);

CREATE INDEX crashes_by_time ON crashes (occurred_at);

CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    attrs TEXT NOT NULL CHECK (json_valid(attrs))
);

CREATE INDEX events_by_time ON events (occurred_at);
