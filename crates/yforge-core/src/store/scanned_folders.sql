CREATE TABLE scanned_folders (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    depth INTEGER NOT NULL,
    scanned_at INTEGER NOT NULL
);

CREATE TABLE scanned_repos (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT NOT NULL REFERENCES scanned_folders (path) ON DELETE CASCADE,
    path TEXT NOT NULL,
    skipped INTEGER NOT NULL CHECK (skipped IN (0, 1)),
    UNIQUE (folder, path)
);
