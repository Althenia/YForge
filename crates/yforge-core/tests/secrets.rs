use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use yforge_core::{
    start_storage, CoreError, HostCredentials, LegacyKeychain, MemoryHostCredentials, Namespace,
    PassphraseStore, Secrets, SqlitePassphrases, GIT_HOSTS_SERVICE,
};

const FOREIGN: &str = "Claude Code-credentials";
const MARKER: &str = "secrets.keychain_pending";

#[derive(Default)]
struct Fake {
    items: Mutex<BTreeMap<(String, String), String>>,
    calls: AtomicUsize,
    fail_accounts: AtomicBool,
    fail_read: AtomicBool,
    fail_delete: AtomicBool,
    deleted: Mutex<Vec<(String, String)>>,
    destination: Mutex<Option<PathBuf>>,
}

impl Fake {
    fn with(items: &[(&str, &str, &str)]) -> Arc<Self> {
        let fake = Arc::new(Self::default());
        for (service, account, value) in items {
            fake.items.lock().unwrap().insert(
                ((*service).to_owned(), (*account).to_owned()),
                (*value).to_owned(),
            );
        }
        fake
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    fn holds(&self, service: &str, account: &str) -> Option<String> {
        self.items
            .lock()
            .unwrap()
            .get(&(service.to_owned(), account.to_owned()))
            .cloned()
    }

    fn remaining(&self) -> usize {
        self.items.lock().unwrap().len()
    }

    fn watch_destination(&self, dir: &Path) {
        *self.destination.lock().unwrap() = Some(dir.to_path_buf());
    }
}

struct Source(Arc<Fake>);

fn refused(detail: &str) -> CoreError {
    CoreError::StorageFailed {
        path: "fake keychain".to_owned(),
        detail: detail.to_owned(),
    }
}

impl LegacyKeychain for Source {
    fn accounts(&self, service: &str) -> Result<Vec<String>, CoreError> {
        self.0.calls.fetch_add(1, Ordering::SeqCst);
        if self.0.fail_accounts.load(Ordering::SeqCst) {
            return Err(refused("enumeration refused"));
        }
        Ok(self
            .0
            .items
            .lock()
            .unwrap()
            .keys()
            .filter(|(candidate, _)| candidate == service)
            .map(|(_, account)| account.clone())
            .collect())
    }

    fn read(&self, service: &str, account: &str) -> Result<Option<String>, CoreError> {
        self.0.calls.fetch_add(1, Ordering::SeqCst);
        if self.0.fail_read.load(Ordering::SeqCst) {
            return Err(refused("read refused"));
        }
        Ok(self.0.holds(service, account))
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), CoreError> {
        self.0.calls.fetch_add(1, Ordering::SeqCst);
        if self.0.fail_delete.load(Ordering::SeqCst) {
            return Err(refused("delete refused"));
        }
        if let Some(dir) = self.0.destination.lock().unwrap().clone() {
            let namespace = if service == Namespace::Ai.service() {
                "ai"
            } else {
                "ssh_passphrase"
            };
            let stored: Option<String> = database(&dir)
                .query_row(
                    "SELECT value FROM secrets WHERE namespace = ?1 AND account = ?2",
                    [namespace, account],
                    |row| row.get(0),
                )
                .ok();
            assert_eq!(
                stored,
                self.0.holds(service, account),
                "a source was deleted before its destination was durable"
            );
        }
        self.0
            .items
            .lock()
            .unwrap()
            .remove(&(service.to_owned(), account.to_owned()));
        self.0
            .deleted
            .lock()
            .unwrap()
            .push((service.to_owned(), account.to_owned()));
        Ok(())
    }
}

fn database(dir: &Path) -> Connection {
    Connection::open(dir.join("yforge.db")).unwrap()
}

fn secrets_with(fake: &Arc<Fake>, dir: &Path) -> Secrets {
    let secrets = Secrets::new(Some(Box::new(Source(fake.clone()))));
    secrets.bind(dir).unwrap();
    secrets
}

fn plain(dir: &Path) -> Secrets {
    let secrets = Secrets::new(None);
    secrets.bind(dir).unwrap();
    secrets
}

fn fresh_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    dir
}

fn upgraded_dir() -> tempfile::TempDir {
    let dir = fresh_dir();
    database(dir.path())
        .execute_batch("DROP TABLE secret_cleanup; DROP TABLE secrets; ALTER TABLE platform_connections DROP COLUMN login; ALTER TABLE platform_connections DROP COLUMN oauth_client_id; ALTER TABLE platform_connections DROP COLUMN auth_method; PRAGMA user_version = 16;")
        .unwrap();
    start_storage(dir.path()).unwrap();
    dir
}

fn marker(dir: &Path) -> bool {
    database(dir)
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = ?1",
            [MARKER],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
        == 1
}

fn cleanup_rows(dir: &Path) -> i64 {
    database(dir)
        .query_row("SELECT COUNT(*) FROM secret_cleanup", [], |row| row.get(0))
        .unwrap()
}

fn stored(dir: &Path, namespace: &str, account: &str) -> Option<String> {
    database(dir)
        .query_row(
            "SELECT value FROM secrets WHERE namespace = ?1 AND account = ?2",
            [namespace, account],
            |row| row.get(0),
        )
        .ok()
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn legacy_items() -> Arc<Fake> {
    let ai = Namespace::Ai.service();
    let ssh = Namespace::SshPassphrase.service();
    Fake::with(&[
        (ai, "provider-1", "key-one"),
        (ai, "provider-1:oauth", "{\"token\":\"oauth-one\"}"),
        (ai, "orphan-provider", "key-orphan"),
        (ai, "platform.conn-1", "platform-token"),
        (ai, "jira.site-1", "jira-token"),
        (ssh, "/keys/id_one", "phrase-one"),
        (ssh, "/keys/removed_host", "phrase-orphan"),
        (FOREIGN, "login", "external-blob"),
    ])
}

#[test]
fn a_secret_is_saved_overwritten_deleted_and_survives_a_new_store_instance() {
    let dir = fresh_dir();
    let secrets = plain(dir.path());

    assert_eq!(secrets.get(Namespace::Ai, "provider").unwrap(), None);
    secrets.set(Namespace::Ai, "provider", "first").unwrap();
    secrets.set(Namespace::Ai, "provider", "second").unwrap();

    let reopened = plain(dir.path());
    assert_eq!(
        reopened.get(Namespace::Ai, "provider").unwrap().as_deref(),
        Some("second")
    );
    reopened.delete(Namespace::Ai, "provider").unwrap();
    reopened.delete(Namespace::Ai, "provider").unwrap();
    assert_eq!(
        plain(dir.path()).get(Namespace::Ai, "provider").unwrap(),
        None
    );
}

#[test]
fn namespaces_keep_the_same_account_apart() {
    let dir = fresh_dir();
    let secrets = plain(dir.path());

    secrets.set(Namespace::Ai, "shared", "ai-value").unwrap();
    secrets
        .set(Namespace::SshPassphrase, "shared", "ssh-value")
        .unwrap();
    secrets.delete(Namespace::Ai, "shared").unwrap();

    assert_eq!(secrets.get(Namespace::Ai, "shared").unwrap(), None);
    assert_eq!(
        secrets
            .get(Namespace::SshPassphrase, "shared")
            .unwrap()
            .as_deref(),
        Some("ssh-value")
    );
}

#[test]
fn saving_rotating_and_deleting_credentials_use_full_durability() {
    let dir = fresh_dir();
    let conn = database(dir.path());
    for operation in ["INSERT", "UPDATE", "DELETE"] {
        conn.execute_batch(&format!(
            "CREATE TRIGGER durable_{operation} BEFORE {operation} ON secrets BEGIN
                SELECT CASE WHEN (SELECT synchronous FROM pragma_synchronous) != 2
                    THEN RAISE(ABORT, 'credential writes must use full durability') END;
             END;"
        ))
        .unwrap();
    }
    drop(conn);
    let secrets = plain(dir.path());
    secrets
        .set(Namespace::Ai, "provider:oauth", "initial")
        .unwrap();
    secrets
        .set(Namespace::Ai, "provider:oauth", "rotated")
        .unwrap();
    assert_eq!(
        plain(dir.path())
            .get(Namespace::Ai, "provider:oauth")
            .unwrap()
            .as_deref(),
        Some("rotated")
    );
    secrets.delete(Namespace::Ai, "provider:oauth").unwrap();
    assert_eq!(
        plain(dir.path())
            .get(Namespace::Ai, "provider:oauth")
            .unwrap(),
        None
    );
}

#[test]
fn an_unbound_store_refuses_and_a_second_bind_is_rejected() {
    let dir = fresh_dir();
    let secrets = Secrets::new(None);

    for result in [
        secrets.get(Namespace::Ai, "a").map(drop),
        secrets.set(Namespace::Ai, "a", "v"),
        secrets.delete(Namespace::Ai, "a"),
    ] {
        assert!(matches!(result, Err(CoreError::StorageFailed { .. })));
    }
    secrets.bind(dir.path()).unwrap();
    assert!(matches!(
        secrets.bind(dir.path()),
        Err(CoreError::StorageFailed { .. })
    ));
    secrets.set(Namespace::Ai, "a", "v").unwrap();
}

#[test]
fn ssh_passphrases_are_kept_in_the_database_by_key_path() {
    let dir = fresh_dir();
    let secrets = Arc::new(plain(dir.path()));
    let store = SqlitePassphrases::new(secrets);

    assert_eq!(store.get("/keys/id").unwrap(), None);
    store.set("/keys/id", "phrase").unwrap();

    assert_eq!(store.get("/keys/id").unwrap().as_deref(), Some("phrase"));
    assert_eq!(
        stored(dir.path(), "ssh_passphrase", "/keys/id").as_deref(),
        Some("phrase")
    );
}

#[test]
fn fresh_empty_and_current_databases_never_touch_the_keychain() {
    let fresh = fresh_dir();
    let empty = tempfile::tempdir().unwrap();
    Connection::open(empty.path().join("yforge.db")).unwrap();
    start_storage(empty.path()).unwrap();
    let current = fresh_dir();
    start_storage(current.path()).unwrap();

    for dir in [&fresh, &empty, &current] {
        assert!(!marker(dir.path()));
        let fake = legacy_items();
        let secrets = secrets_with(&fake, dir.path());
        assert_eq!(secrets.get(Namespace::Ai, "provider-1").unwrap(), None);
        secrets.set(Namespace::Ai, "new", "value").unwrap();
        assert_eq!(fake.calls(), 0);
        assert_eq!(fake.remaining(), 8);
    }
}

#[test]
fn only_a_database_older_than_the_secret_table_is_marked_for_migration() {
    let dir = upgraded_dir();

    assert!(marker(dir.path()));
    start_storage(dir.path()).unwrap();
    assert!(marker(dir.path()));
    assert_eq!(cleanup_rows(dir.path()), 0);
}

#[test]
fn a_marked_database_moves_every_yforge_secret_including_orphans_and_leaves_external_items() {
    let dir = upgraded_dir();
    let fake = legacy_items();
    fake.watch_destination(dir.path());
    let secrets = secrets_with(&fake, dir.path());

    assert_eq!(
        secrets
            .get(Namespace::Ai, "orphan-provider")
            .unwrap()
            .as_deref(),
        Some("key-orphan")
    );

    assert_eq!(
        secrets
            .get(Namespace::SshPassphrase, "/keys/removed_host")
            .unwrap()
            .as_deref(),
        Some("phrase-orphan")
    );
    assert_eq!(
        stored(dir.path(), "ai", "provider-1:oauth").as_deref(),
        Some("{\"token\":\"oauth-one\"}")
    );
    assert_eq!(
        stored(dir.path(), "ai", "platform.conn-1").as_deref(),
        Some("platform-token")
    );
    assert_eq!(
        stored(dir.path(), "ai", "jira.site-1").as_deref(),
        Some("jira-token")
    );
    assert_eq!(
        stored(dir.path(), "ssh_passphrase", "/keys/id_one").as_deref(),
        Some("phrase-one")
    );
    assert!(!marker(dir.path()));
    assert_eq!(cleanup_rows(dir.path()), 0);
    assert_eq!(fake.remaining(), 1);
    assert_eq!(
        fake.holds(FOREIGN, "login").as_deref(),
        Some("external-blob")
    );
    assert_eq!(fake.deleted.lock().unwrap().len(), 7);

    let calls = fake.calls();
    secrets.set(Namespace::Ai, "later", "value").unwrap();
    assert_eq!(fake.calls(), calls);
    let restarted = secrets_with(&fake, dir.path());
    restarted.get(Namespace::Ai, "later").unwrap();
    assert_eq!(fake.calls(), calls);
}

#[test]
fn a_source_that_cannot_be_listed_or_read_leaves_everything_untouched() {
    for reading in [false, true] {
        let dir = upgraded_dir();
        let fake = legacy_items();
        if reading {
            fake.fail_read.store(true, Ordering::SeqCst);
        } else {
            fake.fail_accounts.store(true, Ordering::SeqCst);
        }
        let secrets = secrets_with(&fake, dir.path());

        let error = secrets.get(Namespace::Ai, "provider-1").unwrap_err();

        assert!(matches!(error, CoreError::StorageFailed { .. }));
        assert!(!format!("{error:?} {error}").contains("key-one"));
        assert!(marker(dir.path()));
        assert_eq!(cleanup_rows(dir.path()), 0);
        assert_eq!(stored(dir.path(), "ai", "provider-1"), None);
        assert_eq!(fake.remaining(), 8);
        assert!(secrets.set(Namespace::Ai, "new", "value").is_err());
    }
}

#[test]
fn a_conflicting_destination_stops_the_move_and_keeps_both_values() {
    let dir = upgraded_dir();
    database(dir.path())
        .execute(
            "INSERT INTO secrets (namespace, account, value, updated_at) VALUES ('ai', 'provider-1', 'synthetic-destination-value', 0)",
            [],
        )
        .unwrap();
    let fake = legacy_items();
    let secrets = secrets_with(&fake, dir.path());

    let error = secrets.get(Namespace::Ai, "provider-1").unwrap_err();

    assert!(matches!(error, CoreError::StorageFailed { .. }));
    let text = format!("{error:?} {error}");
    assert!(!text.contains("synthetic-destination-value") && !text.contains("key-one"));
    assert_eq!(
        stored(dir.path(), "ai", "provider-1").as_deref(),
        Some("synthetic-destination-value")
    );
    assert_eq!(
        fake.holds(Namespace::Ai.service(), "provider-1").as_deref(),
        Some("key-one")
    );
    assert_eq!(fake.remaining(), 8);
    assert!(marker(dir.path()));
    assert_eq!(cleanup_rows(dir.path()), 0);
    assert_eq!(stored(dir.path(), "ai", "jira.site-1"), None);
}

#[test]
fn an_equal_destination_is_accepted_so_an_interrupted_copy_can_be_repeated() {
    let dir = upgraded_dir();
    database(dir.path())
        .execute(
            "INSERT INTO secrets (namespace, account, value, updated_at) VALUES ('ai', 'provider-1', 'key-one', 0)",
            [],
        )
        .unwrap();
    let fake = legacy_items();
    let secrets = secrets_with(&fake, dir.path());

    assert_eq!(
        secrets.get(Namespace::Ai, "provider-1").unwrap().as_deref(),
        Some("key-one")
    );
    assert_eq!(fake.remaining(), 1);
}

#[test]
fn a_refused_destination_write_keeps_the_sources_and_the_marker() {
    let dir = upgraded_dir();
    database(dir.path())
        .execute_batch(
            "CREATE TRIGGER refuse BEFORE INSERT ON secrets BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();
    let fake = legacy_items();
    let secrets = secrets_with(&fake, dir.path());

    assert!(secrets.get(Namespace::Ai, "provider-1").is_err());

    assert_eq!(fake.remaining(), 8);
    assert!(fake.deleted.lock().unwrap().is_empty());
    assert!(marker(dir.path()));
    assert_eq!(cleanup_rows(dir.path()), 0);
}

#[test]
fn a_destination_that_fails_verification_keeps_every_source_until_it_is_repaired() {
    let dir = upgraded_dir();
    database(dir.path())
        .execute_batch(
            "CREATE TRIGGER tamper AFTER INSERT ON secrets BEGIN
                UPDATE secrets SET value = 'tampered' WHERE namespace = NEW.namespace AND account = NEW.account;
             END;",
        )
        .unwrap();
    let fake = legacy_items();
    let secrets = secrets_with(&fake, dir.path());

    assert!(secrets.get(Namespace::Ai, "provider-1").is_err());
    assert!(fake.deleted.lock().unwrap().is_empty());
    assert_eq!(fake.remaining(), 8);
    assert!(!marker(dir.path()));
    assert_eq!(cleanup_rows(dir.path()), 7);

    assert!(secrets.get(Namespace::Ai, "provider-1").is_err());
    assert_eq!(fake.remaining(), 8);

    let connection = database(dir.path());
    connection.execute_batch("DROP TRIGGER tamper;").unwrap();
    for (namespace, account, value) in [
        ("ai", "provider-1", "key-one"),
        ("ai", "provider-1:oauth", "{\"token\":\"oauth-one\"}"),
        ("ai", "orphan-provider", "key-orphan"),
        ("ai", "platform.conn-1", "platform-token"),
        ("ai", "jira.site-1", "jira-token"),
        ("ssh_passphrase", "/keys/id_one", "phrase-one"),
        ("ssh_passphrase", "/keys/removed_host", "phrase-orphan"),
    ] {
        connection
            .execute(
                "UPDATE secrets SET value = ?3 WHERE namespace = ?1 AND account = ?2",
                [namespace, account, value],
            )
            .unwrap();
    }
    drop(connection);

    assert_eq!(
        secrets.get(Namespace::Ai, "provider-1").unwrap().as_deref(),
        Some("key-one")
    );
    assert_eq!(fake.remaining(), 1);
    assert_eq!(cleanup_rows(dir.path()), 0);
}

#[test]
fn a_refused_source_delete_is_retried_after_a_restart_without_copying_again() {
    let dir = upgraded_dir();
    let fake = legacy_items();
    fake.fail_delete.store(true, Ordering::SeqCst);
    let secrets = secrets_with(&fake, dir.path());

    let error = secrets.get(Namespace::Ai, "provider-1").unwrap_err();

    assert!(matches!(error, CoreError::StorageFailed { .. }));
    assert!(!marker(dir.path()));
    assert_eq!(cleanup_rows(dir.path()), 7);
    assert_eq!(
        stored(dir.path(), "ai", "provider-1").as_deref(),
        Some("key-one")
    );
    assert_eq!(fake.remaining(), 8);
    assert!(secrets.set(Namespace::Ai, "new", "value").is_err());

    fake.fail_delete.store(false, Ordering::SeqCst);
    fake.fail_accounts.store(true, Ordering::SeqCst);
    let restarted = secrets_with(&fake, dir.path());
    assert_eq!(
        restarted
            .get(Namespace::Ai, "provider-1")
            .unwrap()
            .as_deref(),
        Some("key-one")
    );
    assert_eq!(fake.remaining(), 1);
    assert_eq!(cleanup_rows(dir.path()), 0);
}

#[test]
fn cleanup_deletes_a_source_only_while_it_still_equals_the_stored_destination() {
    let ai = Namespace::Ai.service();
    let dir = fresh_dir();
    database(dir.path())
        .execute_batch(
            "INSERT INTO secrets (namespace, account, value, updated_at) VALUES
                ('ai', 'changed', 'stored', 0), ('ai', 'gone', 'stored', 0), ('ai', 'steady', 'stored', 0);",
        )
        .unwrap();
    let insert_cleanup = |account: &str| {
        database(dir.path())
            .execute(
                "INSERT INTO secret_cleanup (service, account) VALUES (?1, ?2)",
                [ai, account],
            )
            .unwrap();
    };
    insert_cleanup("changed");
    insert_cleanup("gone");
    insert_cleanup("steady");
    let fake = Fake::with(&[(ai, "changed", "edited"), (ai, "steady", "stored")]);
    let secrets = secrets_with(&fake, dir.path());

    assert!(secrets.get(Namespace::Ai, "steady").is_err());

    assert_eq!(fake.holds(ai, "changed").as_deref(), Some("edited"));
    assert_eq!(fake.holds(ai, "steady"), None);
    assert_eq!(cleanup_rows(dir.path()), 1);
    assert_eq!(
        stored(dir.path(), "ai", "changed").as_deref(),
        Some("stored")
    );
    database(dir.path())
        .execute("DELETE FROM secret_cleanup WHERE account = 'changed'", [])
        .unwrap();
    assert_eq!(
        secrets.get(Namespace::Ai, "gone").unwrap().as_deref(),
        Some("stored")
    );
    assert_eq!(cleanup_rows(dir.path()), 0);
}

#[test]
fn cleanup_keeps_a_source_whose_destination_is_missing() {
    let ai = Namespace::Ai.service();
    let dir = fresh_dir();
    database(dir.path())
        .execute(
            "INSERT INTO secret_cleanup (service, account) VALUES (?1, 'lonely')",
            [ai],
        )
        .unwrap();
    let fake = Fake::with(&[(ai, "lonely", "value")]);
    let secrets = secrets_with(&fake, dir.path());

    assert!(secrets.get(Namespace::Ai, "lonely").is_err());

    assert_eq!(fake.holds(ai, "lonely").as_deref(), Some("value"));
    assert_eq!(cleanup_rows(dir.path()), 1);
}

#[test]
fn a_cleanup_row_for_a_service_yforge_does_not_own_is_never_deleted() {
    let dir = fresh_dir();
    database(dir.path())
        .execute(
            "INSERT INTO secret_cleanup (service, account) VALUES (?1, 'login')",
            [FOREIGN],
        )
        .unwrap();
    let fake = legacy_items();
    let secrets = secrets_with(&fake, dir.path());

    assert!(secrets.get(Namespace::Ai, "provider-1").is_err());

    assert_eq!(
        fake.holds(FOREIGN, "login").as_deref(),
        Some("external-blob")
    );
    assert!(fake.deleted.lock().unwrap().is_empty());
    assert_eq!(cleanup_rows(dir.path()), 1);
}

#[test]
fn a_custom_data_folder_with_unmoved_credentials_fails_closed_and_claims_nothing() {
    let dir = upgraded_dir();
    let secrets = plain(dir.path());

    for result in [
        secrets.get(Namespace::Ai, "provider-1").map(drop),
        secrets.set(Namespace::Ai, "provider-1", "value"),
        secrets.delete(Namespace::Ai, "provider-1"),
    ] {
        let error = result.unwrap_err();
        assert!(error.to_string().contains("not moved"), "{error}");
    }
    assert!(marker(dir.path()));
    assert_eq!(stored(dir.path(), "ai", "provider-1"), None);

    let waiting = fresh_dir();
    database(waiting.path())
        .execute(
            "INSERT INTO secret_cleanup (service, account) VALUES (?1, 'x')",
            [Namespace::Ai.service()],
        )
        .unwrap();
    assert!(plain(waiting.path()).get(Namespace::Ai, "x").is_err());
    assert_eq!(cleanup_rows(waiting.path()), 1);
}

#[test]
fn the_data_folder_database_and_sidecars_are_owner_only() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("data");
    start_storage(&dir).unwrap();
    plain(&dir).set(Namespace::Ai, "provider", "value").unwrap();

    assert_eq!(mode(&dir), 0o700);
    assert_eq!(mode(&dir.join("yforge.db")), 0o600);
    let held = Connection::open(dir.join("yforge.db")).unwrap();
    held.pragma_update(None, "journal_mode", "WAL").unwrap();
    held.execute_batch("CREATE TABLE IF NOT EXISTS probe (x); INSERT INTO probe VALUES (1);")
        .unwrap();
    for sidecar in ["yforge.db-wal", "yforge.db-shm"] {
        assert_eq!(mode(&dir.join(sidecar)), 0o600, "{sidecar}");
    }
}

#[test]
fn an_existing_world_readable_folder_and_database_are_tightened() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("data");
    fs::create_dir(&dir).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    Connection::open(dir.join("yforge.db")).unwrap();
    fs::set_permissions(dir.join("yforge.db"), fs::Permissions::from_mode(0o644)).unwrap();

    start_storage(&dir).unwrap();

    assert_eq!(mode(&dir), 0o700);
    assert_eq!(mode(&dir.join("yforge.db")), 0o600);
    assert_eq!(mode(&dir.join("diagnostics.db")), 0o600);
}

#[test]
fn the_safety_copy_taken_before_a_migration_is_owner_only() {
    let dir = fresh_dir();
    database(dir.path())
        .execute_batch("DROP TABLE secret_cleanup; PRAGMA user_version = 16;")
        .unwrap();

    assert!(start_storage(dir.path()).is_err());

    let copy = dir.path().join("yforge.db.pre-migration");
    assert!(copy.exists());
    assert_eq!(mode(&copy), 0o600);
}

#[cfg(target_os = "macos")]
#[test]
fn the_native_keychain_refuses_every_service_yforge_does_not_own_before_touching_it() {
    use yforge_core::NativeKeychain;

    let native = NativeKeychain;
    assert!(native.accounts(FOREIGN).is_err());
    assert!(native.read(FOREIGN, "login").is_err());
    assert!(native.delete(FOREIGN, "login").is_err());
    assert!(native.accounts("").is_err());
}

#[test]
fn git_host_credentials_live_in_their_own_keychain_service_and_are_never_migrated() {
    assert_eq!(GIT_HOSTS_SERVICE, "dev.yforge.desktop.git-hosts");
    assert_ne!(Namespace::Ai.service(), GIT_HOSTS_SERVICE);
    assert_ne!(Namespace::SshPassphrase.service(), GIT_HOSTS_SERVICE);
    let dir = upgraded_dir();
    let fake = Fake::with(&[(
        GIT_HOSTS_SERVICE,
        "git-host-1",
        "{\"access_token\":\"synthetic\"}",
    )]);
    let secrets = secrets_with(&fake, dir.path());

    assert_eq!(secrets.get(Namespace::Ai, "provider").unwrap(), None);

    assert_eq!(
        fake.holds(GIT_HOSTS_SERVICE, "git-host-1").as_deref(),
        Some("{\"access_token\":\"synthetic\"}")
    );
    assert!(fake.deleted.lock().unwrap().is_empty());
    assert!(!marker(dir.path()));
    let copied: i64 = database(dir.path())
        .query_row("SELECT COUNT(*) FROM secrets", [], |row| row.get(0))
        .unwrap();
    assert_eq!(copied, 0);
}

#[test]
fn memory_host_credentials_save_replace_and_delete_by_account() {
    let store = MemoryHostCredentials::default();
    assert_eq!(store.get("git-host-1").unwrap(), None);
    store.set("git-host-1", "first").unwrap();
    store.set("git-host-1", "second").unwrap();
    assert_eq!(store.get("git-host-1").unwrap().as_deref(), Some("second"));
    store.delete("git-host-1").unwrap();
    store.delete("git-host-1").unwrap();
    assert_eq!(store.get("git-host-1").unwrap(), None);
}

#[cfg(target_os = "macos")]
struct KeychainCleanup<'a> {
    store: &'a yforge_core::KeychainHostCredentials,
    account: &'a str,
}

#[cfg(target_os = "macos")]
impl Drop for KeychainCleanup<'_> {
    fn drop(&mut self) {
        let _ = self.store.delete(self.account);
    }
}

#[cfg(target_os = "macos")]
#[test]
fn keychain_host_credentials_save_replace_and_delete_in_an_isolated_service() {
    for namespace in [Namespace::Ai, Namespace::SshPassphrase] {
        assert_ne!(namespace.service(), GIT_HOSTS_SERVICE);
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let service = format!("dev.yforge.test.git-hosts.{}-{nanos}", std::process::id());
    let store = yforge_core::KeychainHostCredentials::with_service(&service);
    let account = "git-host-synthetic";
    let _cleanup = KeychainCleanup {
        store: &store,
        account,
    };

    assert_eq!(store.get(account).expect("Keychain read"), None);
    store
        .set(account, r#"{"access_token":"synthetic-first"}"#)
        .expect("Keychain write");
    assert_eq!(
        store.get(account).expect("Keychain read").as_deref(),
        Some(r#"{"access_token":"synthetic-first"}"#)
    );
    store
        .set(account, r#"{"access_token":"synthetic-second"}"#)
        .expect("Keychain overwrite");
    assert_eq!(
        store.get(account).expect("Keychain read").as_deref(),
        Some(r#"{"access_token":"synthetic-second"}"#)
    );
    store.delete(account).expect("Keychain delete");
    assert_eq!(store.get(account).expect("Keychain read"), None);
    store
        .delete(account)
        .expect("Keychain delete of a missing item");
}
