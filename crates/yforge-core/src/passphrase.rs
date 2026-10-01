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
