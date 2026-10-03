use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::error::CoreError;
use crate::git;
use crate::repo;
use crate::stage;
use crate::undo;

static SCRATCH_COUNTER: AtomicU32 = AtomicU32::new(0);

struct ScratchIndex {
    path: PathBuf,
    env: String,
}

impl ScratchIndex {
    fn create(root: &Path) -> Result<Self, CoreError> {
        let git_path = |name: &str| -> Result<PathBuf, CoreError> {
            let output = git::run(root, &["rev-parse", "--git-path", name])?;
            Ok(root.join(output.trim_end_matches('\n')))
        };
        let real = git_path("index")?;
        let scratch = git_path(&format!(
            "yforge-patch-index-{}-{}",
            std::process::id(),
            SCRATCH_COUNTER.fetch_add(1, Ordering::SeqCst)
        ))?;
        if real.is_file() {
            fs::copy(&real, &scratch).map_err(|error| failed_io(&scratch, &error))?;
        }
        Ok(Self {
            env: scratch.to_string_lossy().into_owned(),
            path: scratch,
        })
    }

    fn run(&self, root: &Path, args: &[&str]) -> Result<String, CoreError> {
        git::run_env(root, args, &[("GIT_INDEX_FILE", &self.env)])
    }

    fn run_unchecked(&self, root: &Path, args: &[&str]) -> Result<git::Completed, CoreError> {
        git::run_with_env(root, args, &[("GIT_INDEX_FILE", &self.env)])
    }
}

impl Drop for ScratchIndex {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn failed_io(target: &Path, error: &std::io::Error) -> CoreError {
    CoreError::GitFailed {
        command: format!("write {}", target.display()),
        status: None,
        stderr: error.to_string(),
    }
}

fn utf8<'a>(target: &'a Path, what: &str) -> Result<&'a str, CoreError> {
    target.to_str().ok_or_else(|| {
        CoreError::invalid_request(format!("the {what} path is not valid text: {target:?}"))
    })
}

fn absolute<'a>(target: &'a Path, what: &str) -> Result<&'a str, CoreError> {
    if !target.is_absolute() {
        return Err(CoreError::invalid_request(format!(
            "the {what} path must be absolute: {target:?}"
        )));
    }
    utf8(target, what)
}

fn diff_base(root: &Path) -> Result<String, CoreError> {
    match undo::head_sha(root)? {
        Some(head) => Ok(head),
        None => Ok(git::run(root, &["hash-object", "-t", "tree", "/dev/null"])?
            .trim()
            .to_owned()),
    }
}

pub fn patch_create(
    path: &Path,
    files: Option<&[String]>,
    destination: &Path,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    if let Some(files) = files {
        repo::check_paths(files)?;
    }
    let target = absolute(destination, "destination")?;
    let base = diff_base(&root)?;
    let scratch = ScratchIndex::create(&root)?;
    let selected = files.unwrap_or_default();

    let mut listing = vec![
        "--literal-pathspecs",
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
    ];
    if files.is_some() {
        listing.push("--");
        listing.extend(selected.iter().map(String::as_str));
    }
    let untracked: Vec<String> = git::run(&root, &listing)?
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect();
    if !untracked.is_empty() {
        scratch.run(
            &root,
            &stage::with_paths(&["add", "--intent-to-add"], &untracked),
        )?;
    }

    let mut diff = vec![
        "--literal-pathspecs",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--binary",
    ];
    let mut names = diff.clone();
    names.extend(["--name-only", "-z", base.as_str()]);
    let mut output_arg = String::new();
    if files.is_some() {
        names.push("--");
        names.extend(selected.iter().map(String::as_str));
    }
    if scratch.run(&root, &names)?.trim_matches('\0').is_empty() {
        return Err(CoreError::invalid_request(
            "there are no changes to put in a patch",
        ));
    }

    let partial = destination.with_file_name(format!(
        ".{}.yforge-partial",
        destination.file_name().map_or_else(
            || "patch".into(),
            |name| name.to_string_lossy().into_owned()
        )
    ));
    output_arg.push_str("--output=");
    output_arg.push_str(utf8(&partial, "destination")?);
    diff.push(&output_arg);
    diff.push(base.as_str());
    if files.is_some() {
        diff.push("--");
        diff.extend(selected.iter().map(String::as_str));
    }
    let written = scratch
        .run(&root, &diff)
        .and_then(|_| fs::rename(&partial, target).map_err(|error| failed_io(destination, &error)));
    if written.is_err() {
        let _ = fs::remove_file(&partial);
    }
    written
}

fn entries(listing: &str) -> BTreeMap<String, Vec<String>> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for record in listing.split('\0').filter(|record| !record.is_empty()) {
        if let Some((meta, name)) = record.split_once('\t') {
            map.entry(name.to_owned())
                .or_default()
                .push(meta.to_owned());
        }
    }
    map
}

fn index_entries(
    root: &Path,
    scratch: Option<&ScratchIndex>,
) -> Result<BTreeMap<String, Vec<String>>, CoreError> {
    let args = ["ls-files", "--stage", "-z"];
    let listing = match scratch {
        Some(scratch) => scratch.run(root, &args)?,
        None => git::run(root, &args)?,
    };
    Ok(entries(&listing))
}

fn refusal(patch: &str, completed: &git::Completed) -> CoreError {
    CoreError::GitFailed {
        command: format!("git apply --3way {patch}"),
        status: completed.status,
        stderr: completed.stderr.trim().to_owned(),
    }
}

struct Dry {
    before: BTreeMap<String, Vec<String>>,
    affected: Vec<String>,
}

fn dry_run(root: &Path, patch: &str) -> Result<Dry, CoreError> {
    let before = index_entries(root, None)?;
    let scratch = ScratchIndex::create(root)?;
    let completed = scratch.run_unchecked(root, &["apply", "--3way", "--cached", patch])?;
    if !completed.succeeded() {
        return Err(refusal(patch, &completed));
    }
    let after = index_entries(root, Some(&scratch))?;
    let affected = before
        .keys()
        .chain(after.keys())
        .filter(|name| before.get(*name) != after.get(*name))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(Dry { before, affected })
}

pub fn patch_affected(path: &Path, patch: &Path) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    Ok(dry_run(&root, absolute(patch, "patch")?)?.affected)
}

pub fn patch_apply(path: &Path, patch: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let patch = absolute(patch, "patch")?;
    let Dry { before, affected } = dry_run(&root, patch)?;
    let completed = git::run_unchecked(&root, &["apply", "--3way", patch], None)?;
    if !completed.succeeded() {
        return Err(refusal(patch, &completed));
    }
    let mut restore = String::new();
    let mut removals = String::new();
    for name in &affected {
        match before.get(name) {
            Some(metas) => {
                for meta in metas {
                    restore.push_str(&format!("{meta}\t{name}\0"));
                }
            }
            None => removals.push_str(&format!("{name}\0")),
        }
    }
    if !removals.is_empty() {
        git::run_with_input(
            &root,
            &["update-index", "--force-remove", "-z", "--stdin"],
            &removals,
        )?;
    }
    if !restore.is_empty() {
        git::run_with_input(&root, &["update-index", "-z", "--index-info"], &restore)?;
    }
    Ok(())
}
