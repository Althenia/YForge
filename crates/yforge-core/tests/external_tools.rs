mod common;

use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use common::Fixture;
use yforge_core::{
    detect_tools, detect_tools_in, editor_command, load_settings, open_in_diff_tool,
    open_in_editor, open_in_merge_tool, save_settings, tool_choices_load, tool_choices_save,
    tools_status, validate_choices, AppSettings, DiffToolSource, ErrorKind, Probe, ToolChoices,
};

#[derive(Default)]
struct FakeProbe {
    existing: HashSet<PathBuf>,
    dirs: Vec<PathBuf>,
    home: Option<PathBuf>,
    xcrun: Option<PathBuf>,
}

impl Probe for FakeProbe {
    fn exists(&self, path: &Path) -> bool {
        self.existing.contains(path)
    }

    fn path_dirs(&self) -> Vec<PathBuf> {
        self.dirs.clone()
    }

    fn home(&self) -> Option<PathBuf> {
        self.home.clone()
    }

    fn xcrun_find(&self, tool: &str) -> Option<PathBuf> {
        self.xcrun.clone().filter(|_| tool == "opendiff")
    }
}

fn isolate_git_config() {
    static ISOLATED: OnceLock<PathBuf> = OnceLock::new();
    ISOLATED.get_or_init(|| {
        let file = std::env::temp_dir().join(format!("yforge-tools-global-{}", std::process::id()));
        fs::write(&file, "").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        file
    });
}

fn choices(merge: &str, diff: &str, editor: &str) -> ToolChoices {
    ToolChoices {
        merge: merge.to_owned(),
        diff: diff.to_owned(),
        editor: editor.to_owned(),
    }
}

fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn mac() -> FakeProbe {
    FakeProbe {
        existing: [
            "/Applications/Cursor.app",
            "/Applications/Visual Studio Code.app",
            "/Users/yui/Applications/Zed.app",
            "/opt/homebrew/bin/ksdiff",
            "/Applications/p4merge.app/Contents/MacOS/p4merge",
        ]
        .map(PathBuf::from)
        .into_iter()
        .collect(),
        dirs: vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ],
        home: Some(PathBuf::from("/Users/yui")),
        xcrun: Some(PathBuf::from("/Applications/Xcode.app/usr/bin/opendiff")),
    }
}

fn installed(tools: &[yforge_core::ToolEntry]) -> Vec<&str> {
    tools
        .iter()
        .filter(|tool| tool.installed)
        .map(|tool| tool.label.as_str())
        .collect()
}

fn conflicted() -> Fixture {
    isolate_git_config();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.commit("b.txt", "clean\n", "Clean file");
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.commit("a.txt", "topic\n", "Topic");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main");
    repo.git_expecting_conflict(&["merge", "topic"]);
    repo
}

fn wait_for(path: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    while fs::read_to_string(path).map_or(true, |text| text.is_empty()) && Instant::now() < deadline
    {
        std::thread::yield_now();
    }
    fs::read_to_string(path).expect("the tool recorded its call")
}

#[test]
fn finds_the_tools_installed_on_this_mac_and_nothing_else() {
    let found = detect_tools(&mac());

    assert_eq!(
        installed(&found.compare),
        ["FileMerge", "Kaleidoscope", "P4Merge"]
    );
    assert_eq!(
        installed(&found.editors),
        ["Visual Studio Code", "Cursor", "Zed"]
    );
    assert_eq!(found.compare.len(), 6);
    assert_eq!(found.editors.len(), 9);
    let bare = detect_tools(&FakeProbe::default());
    assert!(installed(&bare.compare).is_empty() && installed(&bare.editors).is_empty());
}

#[test]
fn reports_git_configs_merge_and_diff_tools_for_the_repository() {
    isolate_git_config();
    let repo = Fixture::init();
    repo.git(&["config", "merge.tool", "vimdiff"]);

    let found = detect_tools_in(Some(&repo.path), &FakeProbe::default()).unwrap();

    assert_eq!(found.git_merge_tool.as_deref(), Some("vimdiff"));
    assert_eq!(found.git_diff_tool, None);
}

#[test]
fn resolves_the_label_of_each_chosen_tool_or_none_when_it_is_unavailable() {
    isolate_git_config();
    let repo = Fixture::init();
    let settings = AppSettings {
        editor_command: "code -r".to_owned(),
        ..AppSettings::default()
    };
    let status = |choices: &ToolChoices, settings: &AppSettings| {
        tools_status(choices, settings, Some(&repo.path), &mac()).unwrap()
    };

    let none = status(&choices("none", "none", "none"), &settings);
    assert_eq!((none.merge, none.diff, none.editor), (None, None, None));

    let chosen = status(&choices("filemerge", "use_merge", "custom"), &settings);
    assert_eq!(chosen.merge.as_deref(), Some("FileMerge"));
    assert_eq!(chosen.diff.as_deref(), Some("FileMerge"));
    assert_eq!(chosen.editor.as_deref(), Some("Custom"));

    let own = status(&choices("filemerge", "p4merge", "cursor"), &settings);
    assert_eq!(own.diff.as_deref(), Some("P4Merge"));
    assert_eq!(own.editor.as_deref(), Some("Cursor"));

    let missing = status(&choices("beyondcompare", "use_merge", "nova"), &settings);
    assert_eq!(
        (missing.merge, missing.diff, missing.editor),
        (None, None, None)
    );

    let empty_custom = status(&choices("none", "none", "custom"), &AppSettings::default());
    assert_eq!(empty_custom.editor, None);

    let without_config = status(&choices("git_config", "git_config", "none"), &settings);
    assert_eq!((without_config.merge, without_config.diff), (None, None));

    repo.git(&["config", "merge.tool", "opendiff"]);
    repo.git(&["config", "diff.tool", "sourcetree"]);
    let configured = status(&choices("git_config", "git_config", "none"), &settings);
    assert_eq!(configured.merge.as_deref(), Some("FileMerge"));
    assert_eq!(configured.diff.as_deref(), Some("sourcetree"));
}

#[test]
fn builds_the_editor_command_for_each_choice() {
    let settings = AppSettings {
        editor_command: "code -r".to_owned(),
        ..AppSettings::default()
    };
    let command = |editor: &str, settings: &AppSettings| {
        editor_command(
            &choices("none", "none", editor),
            settings,
            &mac(),
            "/repo/a.rs",
        )
    };

    assert_eq!(
        command("custom", &settings).unwrap(),
        (
            "code".to_owned(),
            vec!["-r".to_owned(), "/repo/a.rs".to_owned()]
        )
    );
    assert_eq!(
        command("cursor", &settings).unwrap(),
        (
            "open".to_owned(),
            vec![
                "-a".to_owned(),
                "/Applications/Cursor.app".to_owned(),
                "/repo/a.rs".to_owned()
            ]
        )
    );
    assert_eq!(
        command("zed", &settings).unwrap().1[1],
        "/Users/yui/Applications/Zed.app"
    );
    assert_eq!(
        command("none", &settings).unwrap_err().to_string(),
        "Choose an external editor in Settings → External tools"
    );
    assert_eq!(
        command("custom", &AppSettings::default())
            .unwrap_err()
            .to_string(),
        "Set the custom editor command in Settings → External tools"
    );
    assert_eq!(
        command("nova", &settings).unwrap_err().to_string(),
        "Nova is not installed"
    );
}

#[test]
fn opening_in_the_editor_launches_the_repository_or_a_file_inside_it() {
    isolate_git_config();
    let repo = Fixture::init();
    repo.commit("src/a.rs", "fn main() {}\n", "First");
    let bin = tempfile::tempdir().unwrap();
    let log = bin.path().join("calls");
    let editor = script(
        bin.path(),
        "ed",
        &format!("echo \"$@\" >> '{}'", log.display()),
    );
    let settings = AppSettings {
        editor_command: format!("{} --reuse", editor.display()),
        ..AppSettings::default()
    };
    let custom = choices("none", "none", "custom");

    open_in_editor(&custom, &settings, &mac(), &repo.path, None).unwrap();
    assert_eq!(
        wait_for(&log).trim(),
        format!("--reuse {}", repo.path.display())
    );
    fs::remove_file(&log).unwrap();

    open_in_editor(&custom, &settings, &mac(), &repo.path, Some("src/a.rs")).unwrap();
    assert_eq!(
        wait_for(&log).trim(),
        format!("--reuse {}", repo.path.join("src/a.rs").display())
    );

    let escaped = open_in_editor(&custom, &settings, &mac(), &repo.path, Some("../outside"));
    assert_eq!(escaped.unwrap_err().kind(), ErrorKind::InvalidRequest);
    let none = open_in_editor(
        &choices("none", "none", "none"),
        &settings,
        &mac(),
        &repo.path,
        None,
    );
    assert_eq!(
        none.unwrap_err().to_string(),
        "Choose an external editor in Settings → External tools"
    );
}

#[test]
fn only_known_choices_are_accepted() {
    for bad in [
        choices("use_merge", "none", "none"),
        choices("none", "vscodium", "none"),
        choices("none", "none", "use_merge"),
        choices("none", "none", "filemerge"),
        choices("custom", "none", "none"),
    ] {
        assert_eq!(
            validate_choices(&bad).unwrap_err().kind(),
            ErrorKind::InvalidRequest,
            "{bad:?}"
        );
    }
    assert!(validate_choices(&choices("git_config", "use_merge", "textmate")).is_ok());
    assert!(validate_choices(&choices("vscode", "git_config", "custom")).is_ok());
}

#[test]
fn stored_choices_start_from_the_existing_editor_command_and_persist() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        tool_choices_load(dir.path()).unwrap(),
        choices("none", "use_merge", "none")
    );

    save_settings(
        dir.path(),
        &AppSettings {
            editor_command: "code -r".to_owned(),
            terminal_command: "open -a iTerm".to_owned(),
            ..AppSettings::default()
        },
    )
    .unwrap();
    assert_eq!(
        tool_choices_load(dir.path()).unwrap(),
        choices("none", "use_merge", "custom")
    );

    tool_choices_save(dir.path(), &choices("git_config", "p4merge", "none")).unwrap();
    assert_eq!(
        tool_choices_load(dir.path()).unwrap(),
        choices("git_config", "p4merge", "none")
    );
    let settings = load_settings(dir.path()).unwrap();
    assert_eq!(
        (
            settings.editor_command.as_str(),
            settings.terminal_command.as_str()
        ),
        ("code -r", "open -a iTerm")
    );

    let refused = tool_choices_save(dir.path(), &choices("nope", "none", "none")).unwrap_err();
    assert_eq!(refused.kind(), ErrorKind::InvalidRequest);
    assert_eq!(
        tool_choices_load(dir.path()).unwrap(),
        choices("git_config", "p4merge", "none")
    );
}

#[test]
fn the_merge_tool_gets_the_three_sides_in_the_repository_and_never_marks_the_file_resolved() {
    let repo = conflicted();
    let bin = tempfile::tempdir().unwrap();
    let log = bin.path().join("merge.log");
    let tool = script(
        bin.path(),
        "merge-tool",
        &format!(
            "{{ pwd -P; cat \"$BASE\"; cat \"$LOCAL\"; cat \"$REMOTE\"; }} > '{}'\necho resolved > \"$MERGED\"",
            log.display()
        ),
    );
    repo.git(&["config", "merge.tool", "fake"]);
    repo.git(&[
        "config",
        "mergetool.fake.cmd",
        &format!("sh '{}'", tool.display()),
    ]);

    open_in_merge_tool(
        &choices("git_config", "none", "none"),
        &mac(),
        &repo.path,
        "a.txt",
    )
    .unwrap();

    let recorded = fs::read_to_string(&log).unwrap();
    let mut lines = recorded.lines();
    assert_eq!(
        Path::new(lines.next().unwrap()),
        repo.path.canonicalize().unwrap()
    );
    assert_eq!(lines.collect::<Vec<_>>(), ["base", "main", "topic"]);
    assert_eq!(repo.read("a.txt"), "resolved\n");
    assert!(repo.git(&["status", "--porcelain"]).starts_with("UU a.txt"));
    assert!(repo.git(&["ls-files", "--unmerged"]).contains("a.txt"));
}

#[test]
fn a_known_merge_tool_is_started_with_its_own_arguments() {
    let repo = conflicted();
    let bin = tempfile::tempdir().unwrap();
    let log = bin.path().join("ks.log");
    script(
        bin.path(),
        "ksdiff",
        &format!(
            "printf '%s\\n' \"$@\" > '{}'\ncat \"$5\" \"$7\" \"$9\" >> '{}'",
            log.display(),
            log.display()
        ),
    );
    let probe = FakeProbe {
        existing: [bin.path().join("ksdiff")].into_iter().collect(),
        dirs: vec![bin.path().to_path_buf()],
        ..FakeProbe::default()
    };

    open_in_merge_tool(
        &choices("kaleidoscope", "none", "none"),
        &probe,
        &repo.path,
        "a.txt",
    )
    .unwrap();

    let recorded = fs::read_to_string(&log).unwrap();
    let lines: Vec<&str> = recorded.lines().collect();
    assert_eq!(&lines[..2], ["--merge", "--output"]);
    assert_eq!(Path::new(lines[2]), repo.path.join("a.txt"));
    assert_eq!(
        (lines[3], lines[5], lines[7], lines[9]),
        ("--base", "--", "--snapshot", "--snapshot")
    );
    assert_eq!(&lines[10..], ["base", "main", "topic"]);
}

#[test]
fn the_merge_tool_refuses_a_file_that_is_not_conflicted_or_a_missing_choice() {
    let repo = conflicted();
    let probe = mac();

    let clean = open_in_merge_tool(
        &choices("filemerge", "none", "none"),
        &probe,
        &repo.path,
        "b.txt",
    );
    assert_eq!(clean.unwrap_err().kind(), ErrorKind::InvalidRequest);
    let none = open_in_merge_tool(
        &choices("none", "none", "none"),
        &probe,
        &repo.path,
        "a.txt",
    );
    assert_eq!(
        none.unwrap_err().to_string(),
        "Choose an external merge tool in Settings → External tools"
    );
    let unknown = {
        repo.git(&["config", "merge.tool", "mystery"]);
        open_in_merge_tool(
            &choices("git_config", "none", "none"),
            &probe,
            &repo.path,
            "a.txt",
        )
    };
    assert!(unknown
        .unwrap_err()
        .to_string()
        .contains("set mergetool.mystery.cmd"));
}

#[test]
fn a_tool_that_fails_is_reported_with_its_own_message() {
    let repo = conflicted();
    let bin = tempfile::tempdir().unwrap();
    let tool = script(bin.path(), "broken", "echo 'license expired' >&2\nexit 3");
    repo.git(&["config", "merge.tool", "broken"]);
    repo.git(&[
        "config",
        "mergetool.broken.cmd",
        &format!("sh '{}'", tool.display()),
    ]);

    let error = open_in_merge_tool(
        &choices("git_config", "none", "none"),
        &mac(),
        &repo.path,
        "a.txt",
    )
    .unwrap_err();

    let text = error.to_string();
    assert!(
        text.contains("broken") && text.contains("status 3") && text.contains("license expired"),
        "{text}"
    );
}

fn diff_recorder(repo: &Fixture, bin: &Path) -> PathBuf {
    let log = bin.join("diff.log");
    let tool = script(
        bin,
        "diff-tool",
        &format!(
            "{{ echo \"[$(cat \"$LOCAL\")]\"; echo \"[$(cat \"$REMOTE\")]\"; echo \"$REMOTE\"; pwd -P; }} > '{}'",
            log.display()
        ),
    );
    repo.git(&["config", "diff.tool", "fake"]);
    repo.git(&[
        "config",
        "difftool.fake.cmd",
        &format!("sh '{}'", tool.display()),
    ]);
    log
}

#[test]
fn the_diff_tool_compares_the_index_with_the_working_file_for_an_unstaged_change() {
    isolate_git_config();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "head\n", "First");
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "working\n");
    let bin = tempfile::tempdir().unwrap();
    let log = diff_recorder(&repo, bin.path());

    open_in_diff_tool(
        &choices("none", "git_config", "none"),
        &mac(),
        &repo.path,
        "a.txt",
        &DiffToolSource::Unstaged,
    )
    .unwrap();

    let recorded = fs::read_to_string(&log).unwrap();
    let lines: Vec<&str> = recorded.lines().collect();
    assert_eq!(&lines[..2], ["[staged]", "[working]"]);
    assert_eq!(Path::new(lines[2]), repo.path.join("a.txt"));
    assert_eq!(Path::new(lines[3]), repo.path.canonicalize().unwrap());
}

#[test]
fn the_diff_tool_compares_head_with_the_index_for_a_staged_change_and_empty_for_a_new_file() {
    isolate_git_config();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "head\n", "First");
    repo.write("a.txt", "staged\n");
    repo.write("new.txt", "fresh\n");
    repo.git(&["add", "a.txt", "new.txt"]);
    let bin = tempfile::tempdir().unwrap();
    let log = diff_recorder(&repo, bin.path());
    let staged = |file: &str| {
        open_in_diff_tool(
            &choices("none", "git_config", "none"),
            &mac(),
            &repo.path,
            file,
            &DiffToolSource::Staged,
        )
        .unwrap();
        fs::read_to_string(&log)
            .unwrap()
            .lines()
            .take(2)
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };

    assert_eq!(staged("a.txt"), ["[head]", "[staged]"]);
    assert_eq!(staged("new.txt"), ["[]", "[fresh]"]);
}

#[test]
fn the_diff_tool_compares_a_commit_with_its_parent_and_follows_the_merge_tool_choice() {
    isolate_git_config();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    let second = repo.commit("a.txt", "two\n", "Second");
    let added = repo.commit("b.txt", "added\n", "Added");
    let bin = tempfile::tempdir().unwrap();
    let log = diff_recorder(&repo, bin.path());
    repo.git(&["config", "merge.tool", "fake"]);
    repo.git(&["config", "mergetool.fake.cmd", "true"]);
    repo.git(&[
        "config",
        "difftool.fake.cmd",
        &format!("sh '{}'", bin.path().join("diff-tool").display()),
    ]);
    let in_commit = |sha: &str, file: &str, diff: &str| {
        open_in_diff_tool(
            &choices("git_config", diff, "none"),
            &mac(),
            &repo.path,
            file,
            &DiffToolSource::Commit {
                sha: sha.to_owned(),
            },
        )
        .unwrap();
        fs::read_to_string(&log)
            .unwrap()
            .lines()
            .take(2)
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };

    assert_eq!(
        in_commit(&second, "a.txt", "git_config"),
        ["[one]", "[two]"]
    );
    assert_eq!(in_commit(&added, "b.txt", "git_config"), ["[]", "[added]"]);
    repo.git(&["config", "--unset", "mergetool.fake.cmd"]);
    repo.git(&[
        "config",
        "mergetool.fake.cmd",
        &format!("sh '{}'", bin.path().join("diff-tool").display()),
    ]);
    assert_eq!(in_commit(&second, "a.txt", "use_merge"), ["[one]", "[two]"]);
}

#[test]
fn the_diff_tool_needs_a_choice() {
    isolate_git_config();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");

    let none = open_in_diff_tool(
        &choices("none", "use_merge", "none"),
        &mac(),
        &repo.path,
        "a.txt",
        &DiffToolSource::Unstaged,
    );

    assert_eq!(
        none.unwrap_err().to_string(),
        "Choose an external diff tool in Settings → External tools"
    );
}
