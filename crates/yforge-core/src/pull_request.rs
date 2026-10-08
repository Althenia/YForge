use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use ts_rs::TS;

use crate::commit;
use crate::git::{self, CancelToken};
use crate::{repo, CoreError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ComparedCommit {
    pub sha: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct BranchComparison {
    pub merge_base: String,
    pub source: String,
    pub target: String,
    pub commits: Vec<ComparedCommit>,
    pub files: u32,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct MergePrediction {
    pub merge_base: String,
    pub conflicted_files: Vec<String>,
}

pub(crate) fn resolve(root: &Path, revision: &str) -> Result<String, CoreError> {
    if revision.is_empty() || revision.contains('\0') {
        return Err(CoreError::invalid_request("enter a revision"));
    }
    Ok(git::run(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{revision}^{{commit}}"),
        ],
    )?
    .trim()
    .to_owned())
}

pub(crate) fn compared(
    root: &Path,
    source: &str,
    target: &str,
) -> Result<(String, String, String), CoreError> {
    let source = resolve(root, source)?;
    let target = resolve(root, target)?;
    let base = git::run(root, &["merge-base", &target, &source])?
        .trim()
        .to_owned();
    Ok((source, target, base))
}

pub fn branch_comparison(
    path: &Path,
    source: &str,
    target: &str,
) -> Result<BranchComparison, CoreError> {
    git::local_read(None, || read_comparison(path, source, target))
}

fn read_comparison(path: &Path, source: &str, target: &str) -> Result<BranchComparison, CoreError> {
    let root = repo::open(path)?;
    let (source, target, merge_base) = compared(&root, source, target)?;
    let range = format!("{target}..{source}");
    let log = git::run(
        &root,
        &[
            "log",
            "--no-show-signature",
            "-z",
            "--format=%H%x00%s%x00%an%x00%at",
            &range,
            "--",
        ],
    )?;
    let fields: Vec<_> = log.trim_end_matches('\0').split('\0').collect();
    let mut commits = Vec::new();
    if !log.is_empty() {
        for row in fields.chunks(4) {
            let [sha, summary, author, time] = row else {
                return Err(CoreError::invalid_output(
                    "git log",
                    "expected commit fields",
                ));
            };
            commits.push(ComparedCommit {
                sha: (*sha).to_owned(),
                summary: (*summary).to_owned(),
                author: (*author).to_owned(),
                timestamp: time
                    .parse()
                    .map_err(|_| CoreError::invalid_output("git log", "invalid timestamp"))?,
            });
        }
    }
    let changed = commit::commit_files(&root, &merge_base, &source)?;
    Ok(BranchComparison {
        merge_base,
        source,
        target,
        commits,
        files: u32::try_from(changed.len())
            .map_err(|_| CoreError::invalid_output("git diff", "too many files"))?,
        additions: changed
            .iter()
            .filter_map(|file| file.additions)
            .map(u64::from)
            .sum(),
        deletions: changed
            .iter()
            .filter_map(|file| file.deletions)
            .map(u64::from)
            .sum(),
    })
}

struct ObjectDirectory(PathBuf);

impl ObjectDirectory {
    fn create(parent: &Path, root: &Path) -> Result<Self, CoreError> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let parent = parent
            .canonicalize()
            .map_err(|error| crate::sqlite::failure(parent, error))?;
        if parent.starts_with(root) {
            return Err(CoreError::invalid_request(
                "the temporary object directory must be outside the repository",
            ));
        }
        loop {
            let path = parent.join(format!(
                "yforge-merge-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(crate::sqlite::failure(&path, error)),
            }
        }
    }
}

impl Drop for ObjectDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

type PredictionKey = (PathBuf, String, String, String);

#[derive(Default)]
pub struct MergePredictor {
    cache: Mutex<HashMap<PredictionKey, MergePrediction>>,
}

impl MergePredictor {
    pub fn predict(
        &self,
        path: &Path,
        ours: &str,
        theirs: &str,
        cancel: &CancelToken,
    ) -> Result<MergePrediction, CoreError> {
        git::local_read(Some(cancel), || {
            self.read_prediction(path, ours, theirs, cancel)
        })
    }

    fn read_prediction(
        &self,
        path: &Path,
        ours: &str,
        theirs: &str,
        cancel: &CancelToken,
    ) -> Result<MergePrediction, CoreError> {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let root = repo::resolve_root(path)?;
        let configured = git::run_allowing(
            &root,
            &[
                "config",
                "--name-only",
                "--get-regexp",
                "^merge\\..*\\.driver$",
            ],
            &[0, 1],
        )?;
        if !configured.trim().is_empty() {
            return Err(CoreError::Unsupported { detail: "Merge prediction cannot safely execute configured external merge drivers. Nothing changed.".to_owned() });
        }
        let (theirs, ours, base) = compared(&root, theirs, ours)?;
        let ours_tree = git::run(&root, &["rev-parse", &format!("{ours}^{{tree}}")])?;
        let theirs_tree = git::run(&root, &["rev-parse", &format!("{theirs}^{{tree}}")])?;
        let key = (root.clone(), ours_tree, theirs_tree, base.clone());
        self.predict_with(key, cancel, || {
            let objects = git::run(
                &root,
                &[
                    "rev-parse",
                    "--path-format=absolute",
                    "--git-path",
                    "objects",
                ],
            )?;
            let temp = ObjectDirectory::create(&std::env::temp_dir(), &root)?;
            let object_dir = temp
                .0
                .to_str()
                .ok_or_else(|| CoreError::invalid_request("temporary path is not UTF-8"))?;
            let alternates = serde_json::to_string(objects.trim())
                .map_err(|error| CoreError::invalid_output("object path", error.to_string()))?;
            let completed = git::run_cancellable_env(
                &root,
                &[
                    "merge-tree",
                    "--write-tree",
                    "--name-only",
                    "-z",
                    &ours,
                    &theirs,
                ],
                &[
                    ("GIT_OBJECT_DIRECTORY", object_dir),
                    ("GIT_ALTERNATE_OBJECT_DIRECTORIES", &alternates),
                    ("GIT_NO_LAZY_FETCH", "1"),
                ],
                cancel,
            );
            fs::remove_dir_all(&temp.0).map_err(|error| crate::sqlite::failure(&temp.0, error))?;
            parse_prediction(completed?, &base)
        })
    }

    fn predict_with(
        &self,
        key: PredictionKey,
        cancel: &CancelToken,
        run: impl FnOnce() -> Result<MergePrediction, CoreError>,
    ) -> Result<MergePrediction, CoreError> {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        {
            let cache = self
                .cache
                .lock()
                .map_err(|_| CoreError::invalid_request("merge prediction cache is unavailable"))?;
            if let Some(prediction) = cache.get(&key) {
                return Ok(prediction.clone());
            }
        }
        let prediction = run()?;
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| CoreError::invalid_request("merge prediction cache is unavailable"))?;
        if cache.len() >= 256 {
            cache.clear();
        }
        cache.insert(key, prediction.clone());
        Ok(prediction)
    }
}

fn parse_prediction(completed: git::Completed, base: &str) -> Result<MergePrediction, CoreError> {
    if completed.status == Some(129)
        && (completed.stderr.contains("write-tree") || completed.stderr.contains("unknown option"))
    {
        return Err(CoreError::Unsupported { detail: "This Git version does not support merge conflict prediction (--write-tree). Nothing changed.".to_owned() });
    }
    if !matches!(completed.status, Some(0 | 1)) {
        return Err(CoreError::GitFailed {
            command: "git merge-tree --write-tree --name-only".to_owned(),
            status: completed.status,
            stderr: completed.stderr,
        });
    }
    let mut fields = completed.stdout.split('\0');
    let tree = fields.next().unwrap_or_default();
    commit::validate_sha(tree)?;
    let conflicted_files = if completed.status == Some(1) {
        fields
            .take_while(|field| !field.is_empty())
            .map(str::to_owned)
            .collect()
    } else {
        Vec::new()
    };
    Ok(MergePrediction {
        merge_base: base.to_owned(),
        conflicted_files,
    })
}

pub fn pull_request_template(path: &Path) -> Result<Option<String>, CoreError> {
    let root = repo::open(path)?;
    for relative in [
        ".github/pull_request_template.md",
        "docs/pull_request_template.md",
        "pull_request_template.md",
        ".gitlab/merge_request_templates/Default.md",
    ] {
        let mut candidate = root.clone();
        let mut found = true;
        for name in relative.split('/') {
            let entries = match fs::read_dir(&candidate) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    found = false;
                    break;
                }
                Err(error) => return Err(crate::sqlite::failure(&candidate, error)),
            };
            let mut matches = Vec::new();
            for entry in entries {
                let entry = entry.map_err(|error| crate::sqlite::failure(&candidate, error))?;
                if entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
                {
                    matches.push(entry.path());
                }
            }
            matches.sort();
            let Some(next) = matches.first() else {
                found = false;
                break;
            };
            candidate = next.clone();
            let canonical = candidate
                .canonicalize()
                .map_err(|error| crate::sqlite::failure(&candidate, error))?;
            if !canonical.starts_with(&root) {
                return Err(CoreError::invalid_request(
                    "pull request template points outside the repository",
                ));
            }
        }
        if found && candidate.is_file() {
            return fs::read_to_string(&candidate)
                .map(Some)
                .map_err(|error| crate::sqlite::failure(&candidate, error));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_tree_cache_hit_does_not_execute_git() {
        let predictor = MergePredictor::default();
        let key = (
            PathBuf::from("repository"),
            "ours-tree".to_owned(),
            "theirs-tree".to_owned(),
            "base".to_owned(),
        );
        let token = CancelToken::new();
        let expected = MergePrediction {
            merge_base: "base".to_owned(),
            conflicted_files: vec!["file".to_owned()],
        };
        predictor
            .predict_with(key.clone(), &token, || Ok(expected.clone()))
            .unwrap();
        assert_eq!(
            predictor
                .predict_with(key, &token, || panic!("cache hit ran git"))
                .unwrap(),
            expected
        );
    }

    #[test]
    fn old_git_is_typed_unsupported() {
        let error = parse_prediction(
            git::Completed {
                status: Some(129),
                stdout: String::new(),
                stderr: "error: unknown option `write-tree'".to_owned(),
            },
            "base",
        )
        .unwrap_err();
        assert_eq!(error.kind(), crate::ErrorKind::Unsupported);
    }

    #[test]
    fn temporary_objects_never_start_inside_the_repository_and_are_removed_on_drop() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().canonicalize().unwrap();
        assert!(ObjectDirectory::create(&root, &root).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let directory = ObjectDirectory::create(&root, &root.join("repository")).unwrap();
        let created = directory.0.clone();
        assert!(created.exists());
        drop(directory);
        assert!(!created.exists());
    }
}
