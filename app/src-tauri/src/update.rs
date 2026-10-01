use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use yforge_core::{ErrorKind, ErrorPayload, UpdateCheck};

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

impl PendingUpdate {
    fn replace(&self, update: Option<Update>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = update;
    }

    fn take(&self) -> Option<Update> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take()
    }
}

pub fn check_failure(error: &Error) -> String {
    match error {
        Error::Reqwest(failure) if failure.is_connect() || failure.is_timeout() => {
            "github.com could not be reached".to_owned()
        }
        other => other.to_string(),
    }
}

pub fn install_failure(error: &Error) -> String {
    match error {
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "The downloaded update failed its signature check and was discarded; nothing was installed"
                .to_owned()
        }
        other => check_failure(other),
    }
}

#[tauri::command]
pub async fn update_check<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<UpdateCheck, ErrorPayload> {
    log::debug!("update_check");
    let found = app
        .updater()
        .map_err(|error| ErrorPayload::internal(check_failure(&error)))?
        .check()
        .await
        .map_err(|error| ErrorPayload::internal(check_failure(&error)))?;
    let current = app.package_info().version.to_string();
    let check = UpdateCheck::from_release(
        &current,
        found
            .as_ref()
            .map(|update| (update.version.as_str(), update.body.as_deref())),
    );
    pending.replace(found);
    Ok(check)
}

#[tauri::command]
pub async fn update_install<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), ErrorPayload> {
    log::debug!("update_install");
    let update = pending.take().ok_or_else(|| ErrorPayload {
        kind: ErrorKind::InvalidRequest,
        message: "Check for an update before installing it".to_owned(),
        output: None,
    })?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| ErrorPayload::internal(install_failure(&error)))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_invalid_signature_is_reported_as_discarded_and_never_installed() {
        let message = install_failure(&Error::SignatureUtf8("bad".to_owned()));

        assert!(message.contains("failed its signature check"), "{message}");
        assert!(message.contains("nothing was installed"), "{message}");
    }

    #[test]
    fn other_failures_keep_the_updater_message() {
        assert_eq!(
            install_failure(&Error::Network("connection reset".to_owned())),
            "`connection reset`"
        );
        assert_eq!(
            check_failure(&Error::ReleaseNotFound),
            "Could not fetch a valid release JSON from the remote"
        );
    }
}
