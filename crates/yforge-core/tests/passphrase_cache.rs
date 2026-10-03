use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use yforge_core::{CachedPassphrases, CoreError, PassphraseStore};

#[derive(Default)]
struct Counting {
    saved: Mutex<HashMap<String, String>>,
    reads: AtomicUsize,
}

impl PassphraseStore for Counting {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(self.saved.lock().unwrap().get(key_path).cloned())
    }

    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError> {
        self.saved
            .lock()
            .unwrap()
            .insert(key_path.to_owned(), passphrase.to_owned());
        Ok(())
    }
}

#[test]
fn reads_a_saved_ssh_passphrase_from_the_keychain_once_per_launch() {
    let backing = Arc::new(Counting::default());
    backing.set("/k/id_ed25519", "pw").unwrap();
    let store = CachedPassphrases::new(backing.clone());

    for _ in 0..4 {
        assert_eq!(store.get("/k/id_ed25519").unwrap().as_deref(), Some("pw"));
    }

    assert_eq!(backing.reads.load(Ordering::SeqCst), 1);
}

#[test]
fn a_replaced_passphrase_is_served_without_reading_the_keychain_again() {
    let backing = Arc::new(Counting::default());
    let store = CachedPassphrases::new(backing.clone());

    assert_eq!(store.get("/k/id_rsa").unwrap(), None);
    store.set("/k/id_rsa", "new").unwrap();

    assert_eq!(store.get("/k/id_rsa").unwrap().as_deref(), Some("new"));
    assert_eq!(backing.reads.load(Ordering::SeqCst), 1);
    assert_eq!(
        backing
            .saved
            .lock()
            .unwrap()
            .get("/k/id_rsa")
            .map(String::as_str),
        Some("new")
    );
}
