CREATE TABLE jira_connections (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('cloud', 'data_center')),
    site TEXT NOT NULL,
    email TEXT,
    display_name TEXT NOT NULL,
    projects TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK ((kind = 'cloud') = (email IS NOT NULL))
);
