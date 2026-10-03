use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use yforge_ai::{CachedStore, MemoryStore, SecretError, SecretStore};

#[derive(Default)]
struct Counting {
    inner: MemoryStore,
    reads: AtomicUsize,
    failing: std::sync::atomic::AtomicBool,
}

impl SecretStore for Counting {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if self.failing.load(Ordering::SeqCst) {
            return Err(SecretError("denied".to_owned()));
        }
        self.inner.get(account)
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        self.inner.set(account, secret)
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        self.inner.delete(account)
    }
}

#[test]
fn reads_each_account_from_the_keychain_once_per_launch() {
    let backing = Arc::new(Counting::default());
    backing.inner.set("openrouter", "sk-1").unwrap();
    let store = CachedStore::new(backing.clone());

    for _ in 0..5 {
        assert_eq!(store.get("openrouter").unwrap().as_deref(), Some("sk-1"));
        assert_eq!(store.get("missing").unwrap(), None);
    }

    assert_eq!(backing.reads.load(Ordering::SeqCst), 2);
}

#[test]
fn serves_what_it_wrote_and_forgets_what_it_deleted_without_reading_again() {
    let backing = Arc::new(Counting::default());
    let store = CachedStore::new(backing.clone());

    store.set("github", "token-a").unwrap();
    assert_eq!(store.get("github").unwrap().as_deref(), Some("token-a"));
    store.delete("github").unwrap();
    assert_eq!(store.get("github").unwrap(), None);

    assert_eq!(backing.reads.load(Ordering::SeqCst), 0);
    assert_eq!(backing.inner.get("github").unwrap(), None);
}

#[test]
fn never_caches_a_refused_read() {
    let backing = Arc::new(Counting::default());
    backing.inner.set("openrouter", "sk-1").unwrap();
    backing.failing.store(true, Ordering::SeqCst);
    let store = CachedStore::new(backing.clone());

    assert!(store.get("openrouter").is_err());
    backing.failing.store(false, Ordering::SeqCst);
    assert_eq!(store.get("openrouter").unwrap().as_deref(), Some("sk-1"));
    assert_eq!(backing.reads.load(Ordering::SeqCst), 2);
}
