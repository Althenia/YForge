use std::cell::RefCell;
use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

const OUTPUT_LIMIT: usize = 64 * 1024;

const QUIET: [&str; 14] = [
    "rev-parse",
    "status",
    "for-each-ref",
    "log",
    "diff",
    "show",
    "cat-file",
    "rev-list",
    "merge-base",
    "ls-files",
    "symbolic-ref",
    "hash-object",
    "credential",
    "config",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CommandRecord {
    pub command: String,
    pub status: Option<i32>,
    pub duration_ms: u32,
    pub output: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UndoStatus {
    Available { scope: String },
    Unavailable { reason: String },
    Undone,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ActivityEntry {
    pub id: u32,
    pub repo: String,
    pub operation: String,
    pub summary: String,
    pub started_at: i64,
    pub duration_ms: u32,
    pub ok: bool,
    pub local: bool,
    pub toast: bool,
    pub error: Option<String>,
    pub commands: Vec<CommandRecord>,
    pub undo: UndoStatus,
}

thread_local! {
    static COLLECTOR: RefCell<Option<Vec<CommandRecord>>> = const { RefCell::new(None) };
}

pub fn collect<T>(task: impl FnOnce() -> T) -> (T, Vec<CommandRecord>) {
    let previous = COLLECTOR.with(|slot| slot.replace(Some(Vec::new())));
    let result = task();
    let records = COLLECTOR
        .with(|slot| slot.replace(previous))
        .unwrap_or_default();
    (result, records)
}

fn subcommand(command: &str) -> &str {
    command
        .split_whitespace()
        .skip(1)
        .find(|token| !token.starts_with('-'))
        .unwrap_or_default()
}

fn is_reading(command: &str) -> bool {
    let name = subcommand(command);
    name.is_empty() || QUIET.contains(&name) && (name != "config" || command.contains("--get"))
}

pub(crate) fn note(command: &str, status: Option<i32>, output: &str, elapsed: Duration) {
    COLLECTOR.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(records) = slot.as_mut() else {
            return;
        };
        if is_reading(command) {
            return;
        }
        let mut output = redact(output.trim());
        if output.len() > OUTPUT_LIMIT {
            let mut end = OUTPUT_LIMIT;
            while !output.is_char_boundary(end) {
                end -= 1;
            }
            output.truncate(end);
            output.push_str("\n… output truncated");
        }
        records.push(CommandRecord {
            command: redact(command),
            status,
            duration_ms: u32::try_from(elapsed.as_millis()).unwrap_or(u32::MAX),
            output,
        });
    });
}

fn redact_userinfo(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let (head, tail) = rest.split_at(at + 3);
        redacted.push_str(head);
        let authority_end = tail
            .find(|c: char| c == '/' || c.is_whitespace() || c == '\'' || c == '"')
            .unwrap_or(tail.len());
        match tail[..authority_end].rfind('@') {
            Some(marker) => {
                redacted.push_str("***@");
                rest = &tail[marker + 1..];
            }
            None => rest = tail,
        }
    }
    redacted.push_str(rest);
    redacted
}

pub fn redact(text: &str) -> String {
    redact_userinfo(text)
        .lines()
        .map(|line| {
            let lowered = line.trim_start().to_lowercase();
            if lowered.starts_with("password=")
                || lowered.starts_with("authorization:")
                || lowered.contains("extraheader=")
            {
                "***".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_url_credentials_and_secret_lines() {
        assert_eq!(
            redact("git clone https://yui:tok3n@example.test/a.git dest"),
            "git clone https://***@example.test/a.git dest"
        );
        assert_eq!(
            redact("fatal: unable to access 'https://tok3n@example.test/a.git/': 401"),
            "fatal: unable to access 'https://***@example.test/a.git/': 401"
        );
        assert_eq!(
            redact("username=yui\npassword=hunter2"),
            "username=yui\n***"
        );
        assert_eq!(redact("git fetch origin"), "git fetch origin");
    }

    #[test]
    fn collects_mutating_commands_and_skips_read_only_ones() {
        let (_, records) = collect(|| {
            note("git --version", Some(0), "git version 2", Duration::ZERO);
            note("git rev-parse HEAD", Some(0), "abc", Duration::ZERO);
            note("git config --get user.name", Some(0), "yui", Duration::ZERO);
            note(
                "git commit -m x",
                Some(0),
                "[main abc] x",
                Duration::from_millis(12),
            );
            note("git config user.name yui", Some(0), "", Duration::ZERO);
        });
        let commands: Vec<&str> = records.iter().map(|r| r.command.as_str()).collect();
        assert_eq!(commands, ["git commit -m x", "git config user.name yui"]);
        assert_eq!(records[0].duration_ms, 12);
    }

    #[test]
    fn notes_outside_a_collection_are_dropped() {
        note("git commit -m x", Some(0), "", Duration::ZERO);
        let (_, records) = collect(|| ());
        assert!(records.is_empty());
    }
}
