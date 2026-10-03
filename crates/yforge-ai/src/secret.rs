use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use thiserror::Error;

pub const KEYCHAIN_SERVICE: &str = "dev.yforge.desktop.ai";
pub const CLAUDE_CODE_SERVICE: &str = "Claude Code-credentials";
const SECURITY_TOOL: &str = "/usr/bin/security";
const SECURITY_NOT_FOUND: i32 = 44;

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

pub struct CachedStore {
    inner: Arc<dyn SecretStore>,
    known: Mutex<HashMap<String, Option<String>>>,
}

impl CachedStore {
    pub fn new(inner: Arc<dyn SecretStore>) -> Self {
        Self {
            inner,
            known: Mutex::new(HashMap::new()),
        }
    }

    fn remember(&self, account: &str, secret: Option<String>) {
        self.known
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(account.to_owned(), secret);
    }
}

impl SecretStore for CachedStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        let mut known = self.known.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(secret) = known.get(account) {
            return Ok(secret.clone());
        }
        let secret = self.inner.get(account)?;
        known.insert(account.to_owned(), secret.clone());
        Ok(secret)
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        self.inner.set(account, secret)?;
        self.remember(account, Some(secret.to_owned()));
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        self.inner.delete(account)?;
        self.remember(account, None);
        Ok(())
    }
}

pub struct ClaudeCodeKeychain;

impl SecretStore for ClaudeCodeKeychain {
    fn get(&self, service: &str) -> Result<Option<String>, SecretError> {
        let output = std::process::Command::new(SECURITY_TOOL)
            .args(["find-generic-password", "-s", service, "-w"])
            .output()
            .map_err(|error| SecretError(format!("could not run {SECURITY_TOOL}: {error}")))?;
        if output.status.success() {
            return Ok(Some(
                String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            ));
        }
        if output.status.code() == Some(SECURITY_NOT_FOUND) {
            return Ok(None);
        }
        Err(SecretError(format!(
            "the Keychain refused to read {service}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }

    fn set(&self, service: &str, _secret: &str) -> Result<(), SecretError> {
        Err(SecretError(format!("{service} is read-only")))
    }

    fn delete(&self, service: &str) -> Result<(), SecretError> {
        Err(SecretError(format!("{service} is read-only")))
    }
}

pub fn oauth_account(provider_id: &str) -> String {
    format!("{provider_id}:oauth")
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
