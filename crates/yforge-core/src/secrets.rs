use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::error::CoreError;
use crate::store::secrets as store;

#[derive(Clone, Copy)]
pub enum Namespace {
    Ai,
    SshPassphrase,
}

impl Namespace {
    pub fn service(self) -> &'static str {
        match self {
            Self::Ai => "dev.yforge.desktop.ai",
            Self::SshPassphrase => "dev.yforge.desktop.ssh-passphrases",
        }
    }

    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Ai => "ai",
            Self::SshPassphrase => "ssh_passphrase",
        }
    }

    pub(crate) fn from_service(service: &str) -> Option<Self> {
        [Self::Ai, Self::SshPassphrase]
            .into_iter()
            .find(|namespace| namespace.service() == service)
    }
}

pub trait LegacyKeychain: Send + Sync {
    fn accounts(&self, service: &str) -> Result<Vec<String>, CoreError>;
    fn read(&self, service: &str, account: &str) -> Result<Option<String>, CoreError>;
    fn delete(&self, service: &str, account: &str) -> Result<(), CoreError>;
}

pub struct Secrets {
    dir: OnceLock<PathBuf>,
    legacy: Option<Box<dyn LegacyKeychain>>,
    ready: Mutex<bool>,
}

fn unavailable(detail: &str) -> CoreError {
    CoreError::StorageFailed {
        path: "saved credentials".to_owned(),
        detail: detail.to_owned(),
    }
}

impl Secrets {
    pub fn new(legacy: Option<Box<dyn LegacyKeychain>>) -> Self {
        Self {
            dir: OnceLock::new(),
            legacy,
            ready: Mutex::new(false),
        }
    }

    pub fn bind(&self, dir: &Path) -> Result<(), CoreError> {
        self.dir
            .set(dir.to_path_buf())
            .map_err(|_| unavailable("the data folder is already bound"))
    }

    fn directory(&self) -> Result<&Path, CoreError> {
        let dir = self
            .dir
            .get()
            .ok_or_else(|| unavailable("the data folder is not ready"))?;
        let mut ready = self
            .ready
            .lock()
            .map_err(|_| unavailable("credential migration was interrupted"))?;
        if !*ready {
            store::migrate(dir, self.legacy.as_deref())?;
            *ready = true;
        }
        Ok(dir)
    }

    pub fn get(&self, namespace: Namespace, account: &str) -> Result<Option<String>, CoreError> {
        store::get(self.directory()?, namespace, account)
    }

    pub fn set(&self, namespace: Namespace, account: &str, value: &str) -> Result<(), CoreError> {
        store::set(self.directory()?, namespace, account, value)
    }

    pub fn delete(&self, namespace: Namespace, account: &str) -> Result<(), CoreError> {
        store::delete(self.directory()?, namespace, account)
    }
}

#[cfg(target_os = "macos")]
pub struct NativeKeychain;

#[cfg(target_os = "macos")]
mod native {
    use std::collections::HashMap;

    use apple_native_keyring_store::keychain::Store;
    use keyring_core::api::CredentialStoreApi;
    use keyring_core::{Entry, Error};

    use super::{unavailable, LegacyKeychain, Namespace, NativeKeychain};
    use crate::error::CoreError;

    fn allow(service: &str) -> Result<(), CoreError> {
        Namespace::from_service(service)
            .map(|_| ())
            .ok_or_else(|| unavailable("the legacy service is not owned by YForge"))
    }

    fn failure(error: Error) -> CoreError {
        let detail = match error {
            Error::PlatformFailure(error) => format!("macOS Keychain failure: {error}"),
            Error::NoStorageAccess(error) => format!("macOS Keychain access refused: {error}"),
            Error::NoEntry => "the legacy item is missing".to_owned(),
            Error::BadEncoding(_) => "the legacy item is not valid UTF-8".to_owned(),
            Error::BadDataFormat(_, _) => "the legacy item has an invalid format".to_owned(),
            Error::Ambiguous(_) => "more than one legacy item matches this account".to_owned(),
            _ => "the legacy Keychain operation is unsupported or invalid".to_owned(),
        };
        unavailable(&detail)
    }

    fn entry(service: &str, account: &str) -> Result<Entry, CoreError> {
        allow(service)?;
        Store::new()
            .and_then(|store| store.build(service, account, None))
            .map_err(failure)
    }

    impl LegacyKeychain for NativeKeychain {
        fn accounts(&self, service: &str) -> Result<Vec<String>, CoreError> {
            allow(service)?;
            let entries = Store::new()
                .and_then(|store| store.search(&HashMap::from([("service", service)])))
                .map_err(failure)?;
            let mut accounts = Vec::new();
            for entry in entries {
                let (found, account) = entry
                    .get_specifiers()
                    .ok_or_else(|| unavailable("a legacy item has no service or account"))?;
                if found != service {
                    return Err(unavailable(
                        "the legacy search returned an unrelated service",
                    ));
                }
                accounts.push(account);
            }
            accounts.sort();
            accounts.dedup();
            Ok(accounts)
        }

        fn read(&self, service: &str, account: &str) -> Result<Option<String>, CoreError> {
            match entry(service, account)?.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(Error::NoEntry) => Ok(None),
                Err(error) => Err(failure(error)),
            }
        }

        fn delete(&self, service: &str, account: &str) -> Result<(), CoreError> {
            match entry(service, account)?.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(()),
                Err(error) => Err(failure(error)),
            }
        }
    }
}
