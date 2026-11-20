use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use crate::error::CoreError;

pub const GIT_HOSTS_SERVICE: &str = "dev.yforge.desktop.git-hosts";

pub trait HostCredentials: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, CoreError>;
    fn set(&self, account: &str, value: &str) -> Result<(), CoreError>;
    fn delete(&self, account: &str) -> Result<(), CoreError>;
}

fn unavailable(detail: &str) -> CoreError {
    CoreError::StorageFailed {
        path: "git host sign-in".to_owned(),
        detail: detail.to_owned(),
    }
}

#[derive(Default)]
pub struct MemoryHostCredentials {
    items: Mutex<HashMap<String, String>>,
}

impl HostCredentials for MemoryHostCredentials {
    fn get(&self, account: &str) -> Result<Option<String>, CoreError> {
        Ok(self
            .items
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(account)
            .cloned())
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CoreError> {
        self.items
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(account.to_owned(), value.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), CoreError> {
        self.items
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(account);
        Ok(())
    }
}

pub struct KeychainHostCredentials {
    service: String,
}

impl KeychainHostCredentials {
    pub fn new() -> Self {
        Self::with_service(GIT_HOSTS_SERVICE)
    }

    pub fn with_service(service: &str) -> Self {
        Self {
            service: service.to_owned(),
        }
    }
}

impl Default for KeychainHostCredentials {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
mod native {
    use apple_native_keyring_store::keychain::Store;
    use keyring_core::api::CredentialStoreApi;
    use keyring_core::{Entry, Error};

    use super::{unavailable, HostCredentials, KeychainHostCredentials};
    use crate::error::CoreError;

    fn failure(error: Error) -> CoreError {
        let detail = match error {
            Error::PlatformFailure(error) => format!("macOS Keychain failure: {error}"),
            Error::NoStorageAccess(error) => format!("macOS Keychain access refused: {error}"),
            Error::BadEncoding(_) => "the saved sign-in is not valid UTF-8".to_owned(),
            Error::BadDataFormat(_, _) => "the saved sign-in has an invalid format".to_owned(),
            Error::Ambiguous(_) => "more than one saved sign-in matches this host".to_owned(),
            _ => "the macOS Keychain operation is unsupported or invalid".to_owned(),
        };
        unavailable(&detail)
    }

    fn entry(service: &str, account: &str) -> Result<Entry, CoreError> {
        Store::new()
            .and_then(|store| store.build(service, account, None))
            .map_err(failure)
    }

    impl HostCredentials for KeychainHostCredentials {
        fn get(&self, account: &str) -> Result<Option<String>, CoreError> {
            match entry(&self.service, account)?.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(Error::NoEntry) => Ok(None),
                Err(error) => Err(failure(error)),
            }
        }

        fn set(&self, account: &str, value: &str) -> Result<(), CoreError> {
            entry(&self.service, account)?
                .set_password(value)
                .map_err(failure)
        }

        fn delete(&self, account: &str) -> Result<(), CoreError> {
            match entry(&self.service, account)?.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(()),
                Err(error) => Err(failure(error)),
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl HostCredentials for KeychainHostCredentials {
    fn get(&self, _account: &str) -> Result<Option<String>, CoreError> {
        Err(unavailable(KEYCHAIN_ONLY))
    }

    fn set(&self, _account: &str, _value: &str) -> Result<(), CoreError> {
        Err(unavailable(KEYCHAIN_ONLY))
    }

    fn delete(&self, _account: &str) -> Result<(), CoreError> {
        Err(unavailable(KEYCHAIN_ONLY))
    }
}

#[cfg(not(target_os = "macos"))]
const KEYCHAIN_ONLY: &str =
    "git host sign-in is saved only in the macOS Keychain, which this system does not have";
