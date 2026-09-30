CREATE TABLE switch_stashes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    repository TEXT NOT NULL,
    branch TEXT NOT NULL,
    sha TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (repository, branch, sha)
);
