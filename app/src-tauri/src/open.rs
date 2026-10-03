use serde::Deserialize;
use yforge_core::{AppSettings, ErrorKind, ErrorPayload, Probe, ToolChoices};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenWith {
    Editor,
    Terminal,
    Finder,
}

pub struct Tools<'a> {
    pub settings: &'a AppSettings,
    pub choices: &'a ToolChoices,
    pub probe: &'a dyn Probe,
}

fn invalid(message: impl Into<String>) -> ErrorPayload {
    ErrorPayload {
        kind: ErrorKind::InvalidRequest,
        message: format!("Invalid request: {}", message.into()),
        output: None,
    }
}

fn custom(command: &str, target: &str) -> Option<(String, Vec<String>)> {
    let mut words = command.split_whitespace().map(str::to_owned);
    let program = words.next()?;
    let mut args: Vec<String> = words.collect();
    args.push(target.to_owned());
    Some((program, args))
}

pub fn open_command(
    with: OpenWith,
    tools: &Tools,
    target: &str,
    is_directory: bool,
    macos: bool,
) -> Result<(String, Vec<String>), ErrorPayload> {
    let (configured, fallback) = match with {
        OpenWith::Editor => {
            return yforge_core::editor_command(tools.choices, tools.settings, tools.probe, target)
                .map_err(ErrorPayload::from)
        }
        OpenWith::Terminal => (
            custom(&tools.settings.terminal_command, target),
            vec!["-a", "Terminal", target],
        ),
        OpenWith::Finder if is_directory => (None, vec![target]),
        OpenWith::Finder => (None, vec!["-R", target]),
    };
    if let Some(command) = configured {
        return Ok(command);
    }
    if !macos {
        return Err(invalid(match with {
            OpenWith::Terminal => "set a terminal command in Settings",
            _ => "revealing a path is only available on macOS",
        }));
    }
    Ok((
        "open".to_owned(),
        fallback.into_iter().map(str::to_owned).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;

    struct Installed(&'static [&'static str]);

    impl Probe for Installed {
        fn exists(&self, path: &Path) -> bool {
            self.0.iter().any(|known| Path::new(known) == path)
        }

        fn path_dirs(&self) -> Vec<PathBuf> {
            Vec::new()
        }

        fn home(&self) -> Option<PathBuf> {
            None
        }

        fn xcrun_find(&self, _tool: &str) -> Option<PathBuf> {
            None
        }
    }

    fn choices(editor: &str) -> ToolChoices {
        ToolChoices {
            merge: "none".to_owned(),
            diff: "use_merge".to_owned(),
            editor: editor.to_owned(),
        }
    }

    fn open(
        with: OpenWith,
        editor: &str,
        command: &str,
        terminal: &str,
        target: &str,
        is_directory: bool,
        macos: bool,
    ) -> Result<(String, Vec<String>), ErrorPayload> {
        let settings = AppSettings {
            editor_command: command.to_owned(),
            terminal_command: terminal.to_owned(),
            ..AppSettings::default()
        };
        let choices = choices(editor);
        let probe = Installed(&["/Applications/Zed.app"]);
        open_command(
            with,
            &Tools {
                settings: &settings,
                choices: &choices,
                probe: &probe,
            },
            target,
            is_directory,
            macos,
        )
    }

    #[test]
    fn configured_commands_receive_the_target_as_the_last_argument() {
        let (program, args) = open(
            OpenWith::Editor,
            "custom",
            "code -r",
            "",
            "/repo/a.rs",
            false,
            true,
        )
        .unwrap();
        assert_eq!(
            (program.as_str(), args),
            ("code", vec!["-r".to_owned(), "/repo/a.rs".to_owned()])
        );
        let (program, args) = open(
            OpenWith::Terminal,
            "none",
            "",
            "open -a iTerm",
            "/repo",
            true,
            true,
        )
        .unwrap();
        assert_eq!(
            (program.as_str(), args),
            (
                "open",
                vec!["-a".to_owned(), "iTerm".to_owned(), "/repo".to_owned()]
            )
        );
    }

    #[test]
    fn the_editor_follows_the_chosen_tool_and_never_guesses() {
        let (program, args) =
            open(OpenWith::Editor, "zed", "", "", "/repo/a.rs", false, true).unwrap();
        assert_eq!(
            (program.as_str(), args),
            (
                "open",
                vec![
                    "-a".to_owned(),
                    "/Applications/Zed.app".to_owned(),
                    "/repo/a.rs".to_owned()
                ]
            )
        );
        let none = open(OpenWith::Editor, "none", "", "", "/repo", true, true).unwrap_err();
        assert_eq!(
            none.message,
            "Choose an external editor in Settings → External tools"
        );
        let missing = open(OpenWith::Editor, "nova", "", "", "/repo", true, true).unwrap_err();
        assert_eq!(missing.message, "Nova is not installed");
    }

    #[test]
    fn empty_terminal_and_finder_settings_fall_back_to_the_macos_defaults() {
        let args = |with, target: &str, is_directory| {
            open(with, "none", "", "", target, is_directory, true)
                .unwrap()
                .1
        };
        assert_eq!(
            args(OpenWith::Terminal, "/r", true),
            ["-a", "Terminal", "/r"]
        );
        assert_eq!(args(OpenWith::Finder, "/r/a", false), ["-R", "/r/a"]);
        assert_eq!(args(OpenWith::Finder, "/r", true), ["/r"]);
    }

    #[test]
    fn other_platforms_need_a_configured_terminal_command() {
        let error = open(OpenWith::Terminal, "none", "", "", "/r", true, false).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidRequest);
        assert!(error.message.contains("terminal command"));
    }
}
