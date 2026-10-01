#![allow(dead_code)]

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use std::collections::HashMap;
use std::sync::Mutex;

use tempfile::TempDir;
use yforge_core::{CoreError, PassphraseStore};

#[derive(Default)]
pub struct Vault {
    pub saved: Mutex<HashMap<String, String>>,
    pub refuse: bool,
}

impl PassphraseStore for Vault {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError> {
        Ok(self.saved.lock().unwrap().get(key_path).cloned())
    }

    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError> {
        if self.refuse {
            return Err(CoreError::InvalidRequest {
                detail: "the Keychain is locked".to_owned(),
            });
        }
        self.saved
            .lock()
            .unwrap()
            .insert(key_path.to_owned(), passphrase.to_owned());
        Ok(())
    }
}

pub struct Fixture {
    _dir: TempDir,
    pub path: PathBuf,
    clock: Cell<i64>,
}

fn run_git(dir: &Path, args: &[&str], clock: i64) -> Output {
    let date = format!("{clock} +0000");
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "commit.gpgsign")
        .env("GIT_CONFIG_VALUE_0", "false")
        .env("GIT_CONFIG_KEY_1", "protocol.file.allow")
        .env("GIT_CONFIG_VALUE_1", "always")
        .output()
        .expect("git runs")
}

impl Fixture {
    pub fn init() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().canonicalize().expect("canonical").join("repo");
        fs::create_dir(&path).expect("repo dir");
        let fixture = Self {
            _dir: dir,
            path,
            clock: Cell::new(1_700_000_000),
        };
        fixture.git(&["init", "-q", "-b", "main"]);
        fixture
    }

    pub fn identity(&self) {
        self.git(&["config", "user.name", "Yui Lin"]);
        self.git(&["config", "user.email", "yui@example.test"]);
        self.git(&["config", "commit.gpgsign", "false"]);
    }

    pub fn numbered(&self, name: &str, changes: &[(usize, &str)]) {
        let contents: String = (1..=30)
            .map(|number| {
                let text = changes
                    .iter()
                    .find(|(line, _)| *line == number)
                    .map_or_else(|| format!("line {number}"), |(_, text)| (*text).to_owned());
                format!("{text}\n")
            })
            .collect();
        self.write(name, &contents);
    }

    pub fn read(&self, name: &str) -> String {
        fs::read_to_string(self.path.join(name)).expect("read file")
    }

    fn tick(&self) -> i64 {
        self.clock.set(self.clock.get() + 60);
        self.clock.get()
    }

    pub fn git(&self, args: &[&str]) -> String {
        let output = run_git(&self.path, args, self.tick());
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    pub fn git_expecting_conflict(&self, args: &[&str]) {
        let output = run_git(&self.path, args, self.tick());
        assert!(
            !output.status.success(),
            "git {args:?} unexpectedly succeeded"
        );
    }

    pub fn write(&self, name: &str, contents: &str) {
        let target = self.path.join(name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("parent dir");
        }
        fs::write(target, contents).expect("write file");
    }

    pub fn commit(&self, name: &str, contents: &str, message: &str) -> String {
        self.write(name, contents);
        self.git(&["add", "--", name]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    pub fn sibling(&self, name: &str) -> PathBuf {
        self.path.parent().expect("parent").join(name)
    }

    pub fn clone_to(&self, name: &str) -> PathBuf {
        let parent = self.path.parent().expect("parent");
        let output = run_git(
            parent,
            &["clone", "-q", self.path.to_str().expect("utf-8"), name],
            self.tick(),
        );
        assert!(output.status.success(), "clone failed");
        self.sibling(name)
    }

    pub fn run_in(&self, dir: &Path, args: &[&str]) -> String {
        let output = run_git(dir, args, self.tick());
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }
}

impl Fixture {
    pub fn add_bare_remote(&self, name: &str) -> PathBuf {
        let remote = self.sibling(name);
        let parent = self.path.parent().expect("parent");
        self.run_in(
            parent,
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                remote.to_str().expect("utf-8"),
            ],
        );
        self.git(&["remote", "add", "origin", remote.to_str().expect("utf-8")]);
        remote
    }

    pub fn clone_of(&self, remote: &Path, name: &str) -> PathBuf {
        let parent = self.path.parent().expect("parent");
        let target = self.sibling(name);
        self.run_in(
            parent,
            &["clone", "-q", remote.to_str().expect("utf-8"), name],
        );
        self.run_in(&target, &["config", "user.name", "Yui Lin"]);
        self.run_in(&target, &["config", "user.email", "yui@example.test"]);
        self.run_in(&target, &["config", "commit.gpgsign", "false"]);
        target
    }

    pub fn commit_in(&self, dir: &Path, name: &str, contents: &str, message: &str) -> String {
        fs::write(dir.join(name), contents).expect("write file");
        self.run_in(dir, &["add", "--", name]);
        self.run_in(dir, &["commit", "-q", "-m", message]);
        self.run_in(dir, &["rev-parse", "HEAD"])
    }
}
