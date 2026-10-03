use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::commit;
use crate::error::CoreError;
use crate::git;
use crate::operation;
use crate::repo;
use crate::store::AppSettings;

pub const CHOICE_NONE: &str = "none";
pub const CHOICE_GIT_CONFIG: &str = "git_config";
pub const CHOICE_USE_MERGE: &str = "use_merge";
pub const CHOICE_CUSTOM: &str = "custom";

const EXTRA_BINARY_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];
const APPLICATION_DIRS: [&str; 1] = ["/Applications"];
const NO_EDITOR: &str = "Choose an external editor in Settings → External tools";
const NO_MERGE_TOOL: &str = "Choose an external merge tool in Settings → External tools";
const NO_DIFF_TOOL: &str = "Choose an external diff tool in Settings → External tools";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ToolChoices {
    pub merge: String,
    pub diff: String,
    pub editor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ToolEntry {
    pub id: String,
    pub label: String,
    pub installed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ToolsDetected {
    pub compare: Vec<ToolEntry>,
    pub editors: Vec<ToolEntry>,
    pub git_merge_tool: Option<String>,
    pub git_diff_tool: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ExternalToolsStatus {
    pub editor: Option<String>,
    pub diff: Option<String>,
    pub merge: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiffToolSource {
    Unstaged,
    Staged,
    Commit { sha: String },
}

pub trait Probe {
    fn exists(&self, path: &Path) -> bool;
    fn path_dirs(&self) -> Vec<PathBuf>;
    fn home(&self) -> Option<PathBuf>;
    fn xcrun_find(&self, tool: &str) -> Option<PathBuf>;
}

pub struct SystemProbe;

impl Probe for SystemProbe {
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn path_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default();
        dirs.extend(EXTRA_BINARY_DIRS.iter().map(PathBuf::from));
        if let Some(home) = self.home() {
            dirs.push(home.join(".local/bin"));
        }
        dirs
    }

    fn home(&self) -> Option<PathBuf> {
        std::env::var_os("HOME").map(PathBuf::from)
    }

    fn xcrun_find(&self, tool: &str) -> Option<PathBuf> {
        let output = Command::new("xcrun")
            .args(["--find", tool])
            .stdin(Stdio::null())
            .output()
            .ok()?;
        let found = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
        (output.status.success() && found.is_file()).then_some(found)
    }
}

enum Location {
    Xcrun(&'static str),
    Binary(&'static str),
    Absolute(&'static str),
}

struct CompareTool {
    id: &'static str,
    label: &'static str,
    aliases: &'static [&'static str],
    locations: &'static [Location],
}

struct Editor {
    id: &'static str,
    label: &'static str,
    bundles: &'static [&'static str],
}

const COMPARE_TOOLS: [CompareTool; 6] = [
    CompareTool {
        id: "filemerge",
        label: "FileMerge",
        aliases: &["opendiff", "filemerge"],
        locations: &[Location::Xcrun("opendiff")],
    },
    CompareTool {
        id: "kaleidoscope",
        label: "Kaleidoscope",
        aliases: &["kaleidoscope", "ksdiff"],
        locations: &[Location::Binary("ksdiff")],
    },
    CompareTool {
        id: "beyondcompare",
        label: "Beyond Compare",
        aliases: &["bc", "bc3", "bc4", "bcomp", "beyondcompare"],
        locations: &[
            Location::Binary("bcomp"),
            Location::Absolute("/Applications/Beyond Compare.app/Contents/MacOS/bcomp"),
        ],
    },
    CompareTool {
        id: "p4merge",
        label: "P4Merge",
        aliases: &["p4merge"],
        locations: &[
            Location::Binary("p4merge"),
            Location::Absolute("/Applications/p4merge.app/Contents/MacOS/p4merge"),
        ],
    },
    CompareTool {
        id: "sublimemerge",
        label: "Sublime Merge",
        aliases: &["smerge", "sublimemerge"],
        locations: &[
            Location::Binary("smerge"),
            Location::Absolute("/Applications/Sublime Merge.app/Contents/SharedSupport/bin/smerge"),
        ],
    },
    CompareTool {
        id: "vscode",
        label: "Visual Studio Code",
        aliases: &["vscode", "code"],
        locations: &[
            Location::Binary("code"),
            Location::Absolute(
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
            ),
        ],
    },
];

const EDITORS: [Editor; 9] = [
    Editor {
        id: "vscode",
        label: "Visual Studio Code",
        bundles: &["Visual Studio Code.app"],
    },
    Editor {
        id: "cursor",
        label: "Cursor",
        bundles: &["Cursor.app"],
    },
    Editor {
        id: "zed",
        label: "Zed",
        bundles: &["Zed.app"],
    },
    Editor {
        id: "sublimetext",
        label: "Sublime Text",
        bundles: &["Sublime Text.app"],
    },
    Editor {
        id: "xcode",
        label: "Xcode",
        bundles: &["Xcode.app"],
    },
    Editor {
        id: "intellij",
        label: "IntelliJ IDEA",
        bundles: &[
            "IntelliJ IDEA.app",
            "IntelliJ IDEA CE.app",
            "IntelliJ IDEA Ultimate.app",
        ],
    },
    Editor {
        id: "nova",
        label: "Nova",
        bundles: &["Nova.app"],
    },
    Editor {
        id: "bbedit",
        label: "BBEdit",
        bundles: &["BBEdit.app"],
    },
    Editor {
        id: "textmate",
        label: "TextMate",
        bundles: &["TextMate.app"],
    },
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Merge,
    Diff,
}

impl Role {
    fn git_tool_key(self) -> &'static str {
        match self {
            Self::Merge => "merge.tool",
            Self::Diff => "diff.tool",
        }
    }

    fn git_section(self) -> &'static str {
        match self {
            Self::Merge => "mergetool",
            Self::Diff => "difftool",
        }
    }

    fn missing(self) -> &'static str {
        match self {
            Self::Merge => NO_MERGE_TOOL,
            Self::Diff => NO_DIFF_TOOL,
        }
    }
}

fn locate(probe: &dyn Probe, location: &Location) -> Option<PathBuf> {
    match location {
        Location::Xcrun(tool) => probe.xcrun_find(tool),
        Location::Binary(name) => probe
            .path_dirs()
            .into_iter()
            .map(|dir| dir.join(name))
            .find(|candidate| probe.exists(candidate)),
        Location::Absolute(path) => {
            let path = PathBuf::from(path);
            probe.exists(&path).then_some(path)
        }
    }
}

fn locate_compare(probe: &dyn Probe, tool: &CompareTool) -> Option<PathBuf> {
    tool.locations
        .iter()
        .find_map(|location| locate(probe, location))
}

fn locate_editor(probe: &dyn Probe, editor: &Editor) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = APPLICATION_DIRS.iter().map(PathBuf::from).collect();
    roots.extend(probe.home().map(|home| home.join("Applications")));
    editor
        .bundles
        .iter()
        .flat_map(|bundle| roots.iter().map(move |root| root.join(bundle)))
        .find(|candidate| probe.exists(candidate))
}

fn compare_tool(id: &str) -> Option<&'static CompareTool> {
    COMPARE_TOOLS.iter().find(|tool| tool.id == id)
}

fn compare_tool_named(name: &str) -> Option<&'static CompareTool> {
    COMPARE_TOOLS
        .iter()
        .find(|tool| tool.aliases.contains(&name))
}

fn editor(id: &str) -> Option<&'static Editor> {
    EDITORS.iter().find(|entry| entry.id == id)
}

pub fn detect_tools(probe: &dyn Probe) -> ToolsDetected {
    let entry = |id: &str, label: &str, installed: bool| ToolEntry {
        id: id.to_owned(),
        label: label.to_owned(),
        installed,
    };
    ToolsDetected {
        compare: COMPARE_TOOLS
            .iter()
            .map(|tool| entry(tool.id, tool.label, locate_compare(probe, tool).is_some()))
            .collect(),
        editors: EDITORS
            .iter()
            .map(|editor| {
                entry(
                    editor.id,
                    editor.label,
                    locate_editor(probe, editor).is_some(),
                )
            })
            .collect(),
        git_merge_tool: None,
        git_diff_tool: None,
    }
}

fn config_dir(root: Option<&Path>) -> PathBuf {
    root.map_or_else(std::env::temp_dir, Path::to_path_buf)
}

fn git_config(root: Option<&Path>, key: &str) -> Result<Option<String>, CoreError> {
    let completed = git::run_unchecked(&config_dir(root), &["config", "--get", key], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned())
        .filter(|value| !value.is_empty()))
}

pub fn detect_tools_in(path: Option<&Path>, probe: &dyn Probe) -> Result<ToolsDetected, CoreError> {
    let root = path.map(repo::open).transpose()?;
    Ok(ToolsDetected {
        git_merge_tool: git_config(root.as_deref(), Role::Merge.git_tool_key())?,
        git_diff_tool: git_config(root.as_deref(), Role::Diff.git_tool_key())?,
        ..detect_tools(probe)
    })
}

pub fn validate_choices(choices: &ToolChoices) -> Result<(), CoreError> {
    let compare =
        |value: &str, extra: &[&str]| extra.contains(&value) || compare_tool(value).is_some();
    if !compare(&choices.merge, &[CHOICE_NONE, CHOICE_GIT_CONFIG]) {
        return Err(CoreError::invalid_request(format!(
            "{:?} is not an external merge tool",
            choices.merge
        )));
    }
    if !compare(
        &choices.diff,
        &[CHOICE_USE_MERGE, CHOICE_NONE, CHOICE_GIT_CONFIG],
    ) {
        return Err(CoreError::invalid_request(format!(
            "{:?} is not an external diff tool",
            choices.diff
        )));
    }
    if ![CHOICE_NONE, CHOICE_CUSTOM].contains(&choices.editor.as_str())
        && editor(&choices.editor).is_none()
    {
        return Err(CoreError::invalid_request(format!(
            "{:?} is not an external editor",
            choices.editor
        )));
    }
    Ok(())
}

pub fn default_choices(settings: &AppSettings) -> ToolChoices {
    ToolChoices {
        merge: CHOICE_NONE.to_owned(),
        diff: CHOICE_USE_MERGE.to_owned(),
        editor: if settings.editor_command.trim().is_empty() {
            CHOICE_NONE
        } else {
            CHOICE_CUSTOM
        }
        .to_owned(),
    }
}

enum Resolved {
    Known {
        tool: &'static CompareTool,
        program: PathBuf,
    },
    Command {
        label: String,
        command: String,
    },
}

impl Resolved {
    fn label(&self) -> &str {
        match self {
            Self::Known { tool, .. } => tool.label,
            Self::Command { label, .. } => label,
        }
    }
}

fn resolve_compare(
    role: Role,
    choices: &ToolChoices,
    root: Option<&Path>,
    probe: &dyn Probe,
    strict: bool,
) -> Result<Option<Resolved>, CoreError> {
    let choice = match role {
        Role::Merge => choices.merge.as_str(),
        Role::Diff if choices.diff == CHOICE_USE_MERGE => choices.merge.as_str(),
        Role::Diff => choices.diff.as_str(),
    };
    let role = if role == Role::Diff && choices.diff == CHOICE_USE_MERGE {
        Role::Merge
    } else {
        role
    };
    match choice {
        CHOICE_NONE => Ok(None),
        CHOICE_GIT_CONFIG => resolve_git_tool(role, root, probe, strict),
        id => {
            let Some(tool) = compare_tool(id) else {
                return Ok(None);
            };
            Ok(locate_compare(probe, tool).map(|program| Resolved::Known { tool, program }))
        }
    }
}

fn resolve_git_tool(
    role: Role,
    root: Option<&Path>,
    probe: &dyn Probe,
    strict: bool,
) -> Result<Option<Resolved>, CoreError> {
    let Some(name) = git_config(root, role.git_tool_key())? else {
        return Ok(None);
    };
    let section = role.git_section();
    if let Some(command) = git_config(root, &format!("{section}.{name}.cmd"))? {
        return Ok(Some(Resolved::Command {
            label: name,
            command,
        }));
    }
    let Some(tool) = compare_tool_named(&name) else {
        return if strict {
            Err(CoreError::InvalidChoice {
                detail: format!(
                    "Git has no command for {name}: set {section}.{name}.cmd in your Git config"
                ),
            })
        } else {
            Ok(Some(Resolved::Command {
                label: name,
                command: String::new(),
            }))
        };
    };
    let program = match git_config(root, &format!("{section}.{name}.path"))? {
        Some(path) => Some(PathBuf::from(path)),
        None => locate_compare(probe, tool),
    };
    match program {
        Some(program) => Ok(Some(Resolved::Known { tool, program })),
        None if strict => Err(CoreError::InvalidChoice {
            detail: format!("{} is not installed", tool.label),
        }),
        None => Ok(None),
    }
}

pub fn tools_status(
    choices: &ToolChoices,
    settings: &AppSettings,
    path: Option<&Path>,
    probe: &dyn Probe,
) -> Result<ExternalToolsStatus, CoreError> {
    let root = path.map(repo::open).transpose()?;
    let label = |role| -> Result<Option<String>, CoreError> {
        Ok(
            resolve_compare(role, choices, root.as_deref(), probe, false)?
                .map(|resolved| resolved.label().to_owned()),
        )
    };
    let editor_label = match choices.editor.as_str() {
        CHOICE_CUSTOM => (!settings.editor_command.trim().is_empty()).then(|| "Custom".to_owned()),
        CHOICE_NONE => None,
        id => editor(id)
            .filter(|entry| locate_editor(probe, entry).is_some())
            .map(|entry| entry.label.to_owned()),
    };
    Ok(ExternalToolsStatus {
        editor: editor_label,
        diff: label(Role::Diff)?,
        merge: label(Role::Merge)?,
    })
}

pub fn editor_command(
    choices: &ToolChoices,
    settings: &AppSettings,
    probe: &dyn Probe,
    target: &str,
) -> Result<(String, Vec<String>), CoreError> {
    match choices.editor.as_str() {
        CHOICE_CUSTOM => {
            let mut words = settings
                .editor_command
                .split_whitespace()
                .map(str::to_owned);
            let program = words.next().ok_or_else(|| CoreError::InvalidChoice {
                detail: "Set the custom editor command in Settings → External tools".to_owned(),
            })?;
            let mut args: Vec<String> = words.collect();
            args.push(target.to_owned());
            Ok((program, args))
        }
        id => {
            let entry = editor(id).ok_or_else(|| CoreError::InvalidChoice {
                detail: NO_EDITOR.to_owned(),
            })?;
            let bundle = locate_editor(probe, entry).ok_or_else(|| CoreError::InvalidChoice {
                detail: format!("{} is not installed", entry.label),
            })?;
            Ok((
                "open".to_owned(),
                vec![
                    "-a".to_owned(),
                    bundle.display().to_string(),
                    target.to_owned(),
                ],
            ))
        }
    }
}

pub fn launch_editor(
    choices: &ToolChoices,
    settings: &AppSettings,
    probe: &dyn Probe,
    target: &Path,
) -> Result<(), CoreError> {
    let (program, args) = editor_command(choices, settings, probe, &target.display().to_string())?;
    Command::new(&program)
        .args(&args)
        .stdin(Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|error| CoreError::GitFailed {
            command: program,
            status: None,
            stderr: error.to_string(),
        })
}

pub fn open_in_editor(
    choices: &ToolChoices,
    settings: &AppSettings,
    probe: &dyn Probe,
    path: &Path,
    file: Option<&str>,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let target = match file {
        Some(file) => {
            repo::check_paths(&[file])?;
            root.join(file)
        }
        None => root,
    };
    launch_editor(choices, settings, probe, &target)
}

static SCRATCH_COUNTER: AtomicU32 = AtomicU32::new(0);

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Result<Self, CoreError> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let dir = std::env::temp_dir().join(format!(
            "yforge-tool-{}-{nanos}-{}",
            std::process::id(),
            SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).map_err(|error| scratch_failure(&dir, &error))?;
        Ok(Self(dir))
    }

    fn file(&self, role: &str, name: &str, bytes: &[u8]) -> Result<PathBuf, CoreError> {
        let dir = self.0.join(role);
        std::fs::create_dir_all(&dir).map_err(|error| scratch_failure(&dir, &error))?;
        let path = dir.join(name);
        std::fs::write(&path, bytes).map_err(|error| scratch_failure(&path, &error))?;
        Ok(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch_failure(path: &Path, error: &std::io::Error) -> CoreError {
    CoreError::GitFailed {
        command: format!("write {}", path.display()),
        status: None,
        stderr: error.to_string(),
    }
}

struct Files {
    base: Option<PathBuf>,
    local: PathBuf,
    remote: PathBuf,
    merged: PathBuf,
    relative: String,
}

fn text(path: &Path) -> String {
    path.display().to_string()
}

fn merge_args(tool: &CompareTool, files: &Files) -> Vec<String> {
    let (local, remote, merged) = (text(&files.local), text(&files.remote), text(&files.merged));
    let base = files.base.as_deref().map(text);
    match tool.id {
        "filemerge" => {
            let mut args = vec![local, remote];
            if let Some(base) = base {
                args.extend(["-ancestor".to_owned(), base]);
            }
            args.extend(["-merge".to_owned(), merged]);
            args
        }
        "kaleidoscope" => {
            let mut args = vec!["--merge".to_owned(), "--output".to_owned(), merged];
            if let Some(base) = base {
                args.extend(["--base".to_owned(), base]);
            }
            args.extend([
                "--".to_owned(),
                local,
                "--snapshot".to_owned(),
                remote,
                "--snapshot".to_owned(),
            ]);
            args
        }
        "beyondcompare" => {
            let mut args = vec![local, remote];
            args.extend(base);
            args.push(format!("-mergeoutput={merged}"));
            args
        }
        "p4merge" => vec![base.unwrap_or_else(|| local.clone()), remote, local, merged],
        "sublimemerge" => {
            let mut args = vec!["mergetool".to_owned()];
            args.extend(base);
            args.extend([local, remote, "-o".to_owned(), merged]);
            args
        }
        _ => vec![
            "--wait".to_owned(),
            "--merge".to_owned(),
            remote,
            local,
            base.unwrap_or_default(),
            merged,
        ],
    }
}

fn diff_args(tool: &CompareTool, files: &Files) -> Vec<String> {
    let (local, remote, result) = (text(&files.local), text(&files.remote), text(&files.merged));
    match tool.id {
        "kaleidoscope" => vec![
            "--partial-changeset".to_owned(),
            "--relative-path".to_owned(),
            files.relative.clone(),
            "--".to_owned(),
            local,
            remote,
        ],
        "sublimemerge" => vec![
            "mergetool".to_owned(),
            local,
            remote,
            "-o".to_owned(),
            result,
        ],
        "vscode" => vec!["--wait".to_owned(), "--diff".to_owned(), local, remote],
        _ => vec![local, remote],
    }
}

fn run_tool(mut command: Command, label: &str, cwd: &Path) -> Result<(), CoreError> {
    let output = command
        .current_dir(cwd)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| CoreError::GitFailed {
            command: label.to_owned(),
            status: None,
            stderr: error.to_string(),
        })?;
    if output.status.success() {
        return Ok(());
    }
    Err(CoreError::GitFailed {
        command: label.to_owned(),
        status: output.status.code(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    })
}

fn launch(resolved: &Resolved, role: Role, files: &Files, root: &Path) -> Result<(), CoreError> {
    let command = match resolved {
        Resolved::Known { tool, program } => {
            let mut command = Command::new(program);
            command.args(match role {
                Role::Merge => merge_args(tool, files),
                Role::Diff => diff_args(tool, files),
            });
            command
        }
        Resolved::Command {
            command: script, ..
        } => {
            let mut command = Command::new("sh");
            command
                .arg("-c")
                .arg(script)
                .env("LOCAL", &files.local)
                .env("REMOTE", &files.remote)
                .env("MERGED", &files.merged)
                .env("BASE", files.base.as_deref().unwrap_or(&files.local));
            command
        }
    };
    run_tool(command, resolved.label(), root)
}

fn require_tool(
    role: Role,
    choices: &ToolChoices,
    root: &Path,
    probe: &dyn Probe,
) -> Result<Resolved, CoreError> {
    resolve_compare(role, choices, Some(root), probe, true)?.ok_or_else(|| {
        CoreError::InvalidChoice {
            detail: role.missing().to_owned(),
        }
    })
}

fn file_name(file: &str) -> String {
    Path::new(file).file_name().map_or_else(
        || file.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

fn blob(root: &Path, spec: &str) -> Result<Option<Vec<u8>>, CoreError> {
    let exists = git::run_unchecked(root, &["cat-file", "-e", spec], None)?;
    if !exists.succeeded() {
        return Ok(None);
    }
    git::run_bytes(root, &["cat-file", "blob", spec]).map(Some)
}

fn unmerged_stages(root: &Path, file: &str) -> Result<[Option<String>; 3], CoreError> {
    let listing = git::run(root, &["ls-files", "--unmerged", "--", file])?;
    let mut stages = [None, None, None];
    for line in listing.lines() {
        let Some((meta, _)) = line.split_once('\t') else {
            continue;
        };
        let mut parts = meta.split(' ');
        let (_mode, sha, stage) = (parts.next(), parts.next(), parts.next());
        if let (Some(sha), Some(stage @ ("1" | "2" | "3"))) = (sha, stage) {
            stages[stage.parse::<usize>().unwrap_or(1) - 1] = Some(sha.to_owned());
        }
    }
    Ok(stages)
}

pub fn open_in_merge_tool(
    choices: &ToolChoices,
    probe: &dyn Probe,
    path: &Path,
    file: &str,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    operation::require_conflicted(&root, &[file.to_owned()])?;
    let resolved = require_tool(Role::Merge, choices, &root, probe)?;
    let scratch = Scratch::new()?;
    let name = file_name(file);
    let stages = unmerged_stages(&root, file)?;
    let write = |role: &str, sha: &Option<String>| -> Result<Option<PathBuf>, CoreError> {
        match sha {
            Some(sha) => {
                let bytes = git::run_bytes(&root, &["cat-file", "blob", sha])?;
                scratch.file(role, &name, &bytes).map(Some)
            }
            None => Ok(None),
        }
    };
    let base = write("base", &stages[0])?;
    let empty = |role: &str| scratch.file(role, &name, b"");
    let local = write("local", &stages[1])?.map_or_else(|| empty("local"), Ok)?;
    let remote = write("remote", &stages[2])?.map_or_else(|| empty("remote"), Ok)?;
    let files = Files {
        base,
        local,
        remote,
        merged: root.join(file),
        relative: file.to_owned(),
    };
    launch(&resolved, Role::Merge, &files, &root)
}

pub fn open_in_diff_tool(
    choices: &ToolChoices,
    probe: &dyn Probe,
    path: &Path,
    file: &str,
    source: &DiffToolSource,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let resolved = require_tool(Role::Diff, choices, &root, probe)?;
    let scratch = Scratch::new()?;
    let name = file_name(file);
    let side = |role: &str, spec: &str| -> Result<PathBuf, CoreError> {
        scratch.file(role, &name, &blob(&root, spec)?.unwrap_or_default())
    };
    let working = root.join(file);
    let (local, remote) = match source {
        DiffToolSource::Unstaged => (
            side("a", &format!(":{file}"))?,
            if working.is_file() {
                working
            } else {
                scratch.file("b", &name, b"")?
            },
        ),
        DiffToolSource::Staged => (
            side("a", &format!("HEAD:{file}"))?,
            side("b", &format!(":{file}"))?,
        ),
        DiffToolSource::Commit { sha } => {
            let change = commit::file_in_commit(&root, sha, file)?;
            let original = change.original.as_deref().unwrap_or(file);
            (
                side("a", &format!("{}:{original}", change.base))?,
                side("b", &format!("{}:{file}", change.sha))?,
            )
        }
    };
    let files = Files {
        base: None,
        local,
        remote,
        merged: scratch.file("result", &name, b"")?,
        relative: file.to_owned(),
    };
    launch(&resolved, Role::Diff, &files, &root)
}
