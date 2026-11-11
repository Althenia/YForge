use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use crate::error::CoreError;
use crate::secrets::{Namespace, Secrets};

pub trait PassphraseStore: Send + Sync {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError>;
    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError>;
}

pub struct SqlitePassphrases {
    secrets: Arc<Secrets>,
}

impl SqlitePassphrases {
    pub fn new(secrets: Arc<Secrets>) -> Self {
        Self { secrets }
    }
}

impl PassphraseStore for SqlitePassphrases {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError> {
        self.secrets.get(Namespace::SshPassphrase, key_path)
    }
    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError> {
        self.secrets
            .set(Namespace::SshPassphrase, key_path, passphrase)
    }
}

pub struct CachedPassphrases {
    inner: Arc<dyn PassphraseStore>,
    known: Mutex<HashMap<String, Option<String>>>,
}

impl CachedPassphrases {
    pub fn new(inner: Arc<dyn PassphraseStore>) -> Self {
        Self {
            inner,
            known: Mutex::new(HashMap::new()),
        }
    }
}

impl PassphraseStore for CachedPassphrases {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError> {
        let mut known = self.known.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(passphrase) = known.get(key_path) {
            return Ok(passphrase.clone());
        }
        let passphrase = self.inner.get(key_path)?;
        known.insert(key_path.to_owned(), passphrase.clone());
        Ok(passphrase)
    }

    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError> {
        self.inner.set(key_path, passphrase)?;
        self.known
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key_path.to_owned(), Some(passphrase.to_owned()));
        Ok(())
    }
}
