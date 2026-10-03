use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use crate::error::CoreError;

pub const PASSPHRASE_SERVICE: &str = "dev.yforge.desktop.ssh-passphrases";

pub trait PassphraseStore: Send + Sync {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError>;
    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError>;
}

pub struct KeychainPassphrases;

fn refused(error: impl std::fmt::Display) -> CoreError {
    CoreError::invalid_request(format!("the Keychain refused the request: {error}"))
}

fn entry(key_path: &str) -> Result<keyring::Entry, CoreError> {
    keyring::Entry::new(PASSPHRASE_SERVICE, key_path).map_err(refused)
}

impl PassphraseStore for KeychainPassphrases {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError> {
        match entry(key_path)?.get_password() {
            Ok(passphrase) => Ok(Some(passphrase)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(refused(error)),
        }
    }

    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError> {
        entry(key_path)?.set_password(passphrase).map_err(refused)
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
