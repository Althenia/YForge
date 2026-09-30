use serde::Deserialize;
use yforge_core::{AppSettings, ErrorKind, ErrorPayload};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenWith {
    Editor,
    Terminal,
    Finder,
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
    settings: &AppSettings,
    target: &str,
    is_directory: bool,
    macos: bool,
) -> Result<(String, Vec<String>), ErrorPayload> {
    let configured = match with {
        OpenWith::Editor => custom(&settings.editor_command, target),
        OpenWith::Terminal => custom(&settings.terminal_command, target),
        OpenWith::Finder => None,
    };
    if let Some(command) = configured {
        return Ok(command);
    }
    if !macos {
        return Err(invalid(match with {
            OpenWith::Editor => "set an editor command in Settings",
            OpenWith::Terminal => "set a terminal command in Settings",
            OpenWith::Finder => "revealing a path is only available on macOS",
        }));
    }
    let args: Vec<&str> = match with {
        OpenWith::Editor if is_directory => vec![target],
        OpenWith::Editor => vec!["-t", target],
        OpenWith::Terminal => vec!["-a", "Terminal", target],
        OpenWith::Finder if is_directory => vec![target],
        OpenWith::Finder => vec!["-R", target],
    };
    Ok((
        "open".to_owned(),
        args.into_iter().map(str::to_owned).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(editor: &str, terminal: &str) -> AppSettings {
        AppSettings {
            editor_command: editor.to_owned(),
            terminal_command: terminal.to_owned(),
            ..AppSettings::default()
        }
    }

    #[test]
    fn configured_commands_receive_the_target_as_the_last_argument() {
        let (program, args) = open_command(
            OpenWith::Editor,
            &settings("code -r", ""),
            "/repo/a.rs",
            false,
            true,
        )
        .unwrap();
        assert_eq!(
            (program.as_str(), args),
            ("code", vec!["-r".to_owned(), "/repo/a.rs".to_owned()])
        );
        let (program, args) = open_command(
            OpenWith::Terminal,
            &settings("", "open -a iTerm"),
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
    fn empty_settings_fall_back_to_the_macos_defaults() {
        let empty = settings("", "");
        assert_eq!(
            open_command(OpenWith::Editor, &empty, "/r/a", false, true)
                .unwrap()
                .1,
            ["-t", "/r/a"]
        );
        assert_eq!(
            open_command(OpenWith::Editor, &empty, "/r", true, true)
                .unwrap()
                .1,
            ["/r"]
        );
        assert_eq!(
            open_command(OpenWith::Terminal, &empty, "/r", true, true)
                .unwrap()
                .1,
            ["-a", "Terminal", "/r"]
        );
        assert_eq!(
            open_command(OpenWith::Finder, &empty, "/r/a", false, true)
                .unwrap()
                .1,
            ["-R", "/r/a"]
        );
    }

    #[test]
    fn other_platforms_need_a_configured_command() {
        let error =
            open_command(OpenWith::Editor, &settings("", ""), "/r", true, false).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidRequest);
        assert!(error.message.contains("editor command"));
    }
}
