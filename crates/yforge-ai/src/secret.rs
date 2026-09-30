use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use thiserror::Error;

pub const KEYCHAIN_SERVICE: &str = "dev.yforge.desktop.ai";

#[derive(Debug, Error)]
#[error("{0}")]
pub struct SecretError(pub String);

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError>;
    fn delete(&self, account: &str) -> Result<(), SecretError>;
}

pub struct KeychainStore;

fn entry(account: &str) -> Result<keyring::Entry, SecretError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|error| SecretError(error.to_string()))
}

impl SecretStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(SecretError(error.to_string())),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        entry(account)?
            .set_password(secret)
            .map_err(|error| SecretError(error.to_string()))
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(SecretError(error.to_string())),
        }
    }
}

#[derive(Default)]
pub struct MemoryStore {
    secrets: Mutex<HashMap<String, String>>,
}

impl MemoryStore {
    pub fn accounts(&self) -> Vec<String> {
        let mut accounts: Vec<String> = self
            .secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .keys()
            .cloned()
            .collect();
        accounts.sort();
        accounts
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        Ok(self
            .secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(account)
            .cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        self.secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        self.secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(account);
        Ok(())
    }
}
