CREATE TABLE git_hosts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    host TEXT NOT NULL UNIQUE,
    ssh_key_path TEXT,
    https_user TEXT,
    created_at INTEGER NOT NULL
);
