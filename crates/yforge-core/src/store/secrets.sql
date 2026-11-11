CREATE TABLE secrets (
    namespace TEXT NOT NULL CHECK (namespace IN ('ai', 'ssh_passphrase')),
    account TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, account)
) WITHOUT ROWID;

CREATE TABLE secret_cleanup (
    service TEXT NOT NULL,
    account TEXT NOT NULL,
    PRIMARY KEY (service, account)
) WITHOUT ROWID;
