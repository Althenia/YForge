CREATE TABLE hook_approvals (
    repository TEXT NOT NULL,
    hook TEXT NOT NULL,
    hash TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    PRIMARY KEY (repository, hook)
);
