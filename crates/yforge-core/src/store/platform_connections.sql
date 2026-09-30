CREATE TABLE platform_connections (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('github', 'gitlab', 'bitbucket')),
    host TEXT NOT NULL,
    name TEXT NOT NULL,
    insecure_tls INTEGER NOT NULL CHECK (insecure_tls IN (0, 1)),
    created_at INTEGER NOT NULL
);
