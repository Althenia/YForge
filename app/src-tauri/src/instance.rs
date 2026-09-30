use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use yforge_core::OpenPathRequested;

pub const OPEN_PATH_REQUESTED_EVENT: &str = "open-path-requested";

pub fn requested_path(argv: &[String], cwd: &str) -> Option<String> {
    let argument = argv.get(1).filter(|argument| !argument.is_empty())?;
    let joined = Path::new(cwd).join(argument);
    let plain: PathBuf = joined
        .components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect();
    Some(plain.to_string_lossy().into_owned())
}

pub fn second_instance<R: Runtime>(app: &AppHandle<R>, argv: &[String], cwd: &str) {
    log::debug!("second-instance argv={} cwd={cwd}", argv.len());
    if let Some(window) = app.get_webview_window("main") {
        for result in [window.unminimize(), window.show(), window.set_focus()] {
            if let Err(error) = result {
                log::warn!("could not focus the main window: {error}");
            }
        }
    }
    if let Some(path) = requested_path(argv, cwd) {
        log::debug!("{OPEN_PATH_REQUESTED_EVENT} path={path}");
        if let Err(error) = app.emit(OPEN_PATH_REQUESTED_EVENT, OpenPathRequested { path }) {
            log::warn!("could not emit {OPEN_PATH_REQUESTED_EVENT}: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(arguments: &[&str]) -> Vec<String> {
        arguments
            .iter()
            .map(|argument| (*argument).to_owned())
            .collect()
    }

    #[test]
    fn an_absolute_argument_is_kept_and_a_relative_one_is_resolved_against_the_callers_directory() {
        assert_eq!(
            requested_path(&argv(&["yforge", "/repos/app"]), "/work"),
            Some("/repos/app".to_owned())
        );
        assert_eq!(
            requested_path(&argv(&["yforge", "app"]), "/work"),
            Some("/work/app".to_owned())
        );
        assert_eq!(
            requested_path(&argv(&["yforge", "."]), "/work"),
            Some("/work".to_owned())
        );
        assert_eq!(
            requested_path(&argv(&["yforge", "./sub/../app"]), "/work"),
            Some("/work/sub/../app".to_owned())
        );
    }

    #[test]
    fn no_argument_or_an_empty_one_requests_no_path() {
        assert_eq!(requested_path(&argv(&["yforge"]), "/work"), None);
        assert_eq!(requested_path(&argv(&["yforge", ""]), "/work"), None);
        assert_eq!(requested_path(&[], "/work"), None);
    }
}
