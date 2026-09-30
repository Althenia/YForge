mod auth;
mod crash;
mod open;
mod tracking;

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use yforge_core::{
    ActivityEntry, AmendInfo, AppInfo, AppSettings, AuthReply, CancelToken, ChangeArea,
    CheckoutOutcome, CheckoutTarget, CommitBrief, CommitDetails, ConflictFile, ConflictSide,
    CoreError, CrashRecord, CrashReport, DiffHunk, ErrorKind, ErrorPayload, FileDiff, ForceLease,
    ForcePushPlan, GraphPage, Identity, IdentityField, IntegrationPreview, MergeMode, MessageEdit,
    OperationKind, OperationOutcome, OperationProgress, Planned, Progress, PullMode, PullOutcome,
    PullReport, PushTarget, RebaseOutcome, RebasePlan, RebaseResult, RebaseStep, RecentRepo,
    RecentStatus, RecomposeGroup, RecomposePreview, RecomposeResult, RemoteInfo, RepoChanged,
    RepoSettings, RepoSnapshot, RepoWatcher, ResetMode, SearchResult, SshKey, StashRestore,
    SwitchStash, TabSession, UsageRecord, WorktreeIntegration, WorktreeStatus,
};

use auth::{PromptRegistry, AUTH_TIMEOUT};
pub use crash::{install_panic_hook, note_repository};
use open::OpenWith;
use tracking::{execute, plain, ActivityLog, Draft, Track};

const REPO_ENV: &str = "YFORGE_REPO";
const DATA_DIR_ENV: &str = "YFORGE_DATA_DIR";
const REPO_CHANGED_EVENT: &str = "repo-changed";
const OPERATION_PROGRESS_EVENT: &str = "operation-progress";

pub struct DataDir(pub PathBuf);

#[derive(Default)]
struct WatchState(Mutex<Option<RepoWatcher>>);

#[derive(Default)]
struct OperationRegistry(Mutex<HashMap<String, CancelToken>>);

impl OperationRegistry {
    fn register(&self, id: &str, token: CancelToken) -> Result<CancelToken, ErrorPayload> {
        let mut running = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if running.contains_key(id) {
            return Err(ErrorPayload {
                kind: ErrorKind::InvalidRequest,
                message: format!("Invalid request: operation {id} is already running"),
                output: None,
            });
        }
        running.insert(id.to_owned(), token.clone());
        Ok(token)
    }

    fn finish(&self, id: &str) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(id);
    }

    fn cancel(&self, id: &str) -> bool {
        match self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
        {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }
}

#[derive(Default)]
struct Operations {
    running: OperationRegistry,
    prompts: PromptRegistry,
}

struct Recorder<'a, R: Runtime> {
    app: AppHandle<R>,
    log: &'a ActivityLog,
}

struct Network<'a, R: Runtime> {
    recorder: Recorder<'a, R>,
    registry: &'a OperationRegistry,
    prompts: &'a PromptRegistry,
}

impl<R: Runtime> Network<'_, R> {
    async fn run<T, F>(
        &self,
        meta: Track,
        id: String,
        interactive: bool,
        summarize: impl FnOnce(&T) -> String + Send + 'static,
        task: F,
    ) -> Result<T, ErrorPayload>
    where
        T: Send + 'static,
        F: FnOnce(&CancelToken, &mut dyn FnMut(Progress)) -> Result<T, CoreError> + Send + 'static,
    {
        let operation = meta.operation.label();
        self.run_planned(
            meta,
            id,
            interactive,
            summarize,
            task,
            (
                || Ok(()),
                move |(), _| {
                    Ok(Planned::Unavailable(format!(
                        "{operation} has no safe undo"
                    )))
                },
            ),
        )
        .await
    }

    async fn run_planned<T, S, F>(
        &self,
        meta: Track,
        id: String,
        interactive: bool,
        summarize: impl FnOnce(&T) -> String + Send + 'static,
        task: F,
        (prepare, plan): (
            impl FnOnce() -> Result<S, CoreError> + Send + 'static,
            impl FnOnce(S, &T) -> Result<Planned, CoreError> + Send + 'static,
        ),
    ) -> Result<T, ErrorPayload>
    where
        T: Send + 'static,
        S: Send + 'static,
        F: FnOnce(&CancelToken, &mut dyn FnMut(Progress)) -> Result<T, CoreError> + Send + 'static,
    {
        let token = if interactive {
            CancelToken::with_auth(self.prompts.handler(
                self.recorder.app.clone(),
                id.clone(),
                AUTH_TIMEOUT,
            ))
        } else {
            CancelToken::new()
        };
        let dir = self.recorder.app.state::<DataDir>().0.clone();
        let repository = meta.repo.clone();
        let key = blocking(move || yforge_core::ssh_key_for(&dir, &repository)).await?;
        log::debug!("network id={id} ssh_key_set={}", key.is_some());
        let token = self.registry.register(&id, token.with_ssh_key(key))?;
        let announced = id.clone();
        let app = self.recorder.app.clone();
        let joined = tauri::async_runtime::spawn_blocking(move || {
            execute(
                &meta,
                summarize,
                prepare,
                || {
                    task(&token, &mut |progress| {
                        let payload = OperationProgress {
                            id: announced.clone(),
                            phase: progress.phase,
                            percent: progress.percent,
                        };
                        log::debug!(
                            "operation-progress id={} phase={:?} percent={:?}",
                            payload.id,
                            payload.phase,
                            payload.percent
                        );
                        if let Err(error) = app.emit(OPERATION_PROGRESS_EVENT, payload) {
                            log::warn!("could not emit {OPERATION_PROGRESS_EVENT}: {error}");
                        }
                    })
                },
                plan,
            )
        })
        .await;
        self.registry.finish(&id);
        let (result, draft) = joined.map_err(|error| ErrorPayload::internal(error.to_string()))?;
        self.recorder.log.record(&self.recorder.app, draft);
        result.map_err(ErrorPayload::from)
    }
}

impl<R: Runtime> Recorder<'_, R> {
    async fn tracked<T, S>(
        &self,
        meta: Track,
        summarize: impl FnOnce(&T) -> String + Send + 'static,
        prepare: impl FnOnce() -> Result<S, CoreError> + Send + 'static,
        run: impl FnOnce() -> Result<T, CoreError> + Send + 'static,
        plan: impl FnOnce(S, &T) -> Result<Planned, CoreError> + Send + 'static,
    ) -> Result<T, ErrorPayload>
    where
        T: Send + 'static,
        S: Send + 'static,
    {
        let (result, draft): (Result<T, CoreError>, Draft) =
            tauri::async_runtime::spawn_blocking(move || {
                execute(&meta, summarize, prepare, run, plan)
            })
            .await
            .map_err(|error| ErrorPayload::internal(error.to_string()))?;
        self.log.record(&self.app, draft);
        result.map_err(ErrorPayload::from)
    }

    async fn recorded<T>(
        &self,
        meta: Track,
        summarize: impl FnOnce(&T) -> String + Send + 'static,
        run: impl FnOnce() -> Result<T, CoreError> + Send + 'static,
    ) -> Result<T, ErrorPayload>
    where
        T: Send + 'static,
    {
        let (result, draft): (Result<T, CoreError>, Draft) =
            tauri::async_runtime::spawn_blocking(move || plain(&meta, summarize, run))
                .await
                .map_err(|error| ErrorPayload::internal(error.to_string()))?;
        self.log.record(&self.app, draft);
        result.map_err(ErrorPayload::from)
    }
}

fn track(repo: &str, operation: OperationKind, local: bool, toast: bool) -> Track {
    Track {
        repo: repo.to_owned(),
        operation,
        local,
        toast,
    }
}

fn counted(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn checkout_label(target: &CheckoutTarget) -> String {
    match target {
        CheckoutTarget::LocalBranch { name }
        | CheckoutTarget::RemoteBranch { name }
        | CheckoutTarget::Tag { name } => name.clone(),
        CheckoutTarget::Commit { sha } => short(sha),
    }
}

async fn blocking<T, F>(task: F) -> Result<T, ErrorPayload>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CoreError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| ErrorPayload::internal(error.to_string()))?
        .map_err(ErrorPayload::from)
}

fn choose_launch_path(
    repo_env: Option<OsString>,
    first_argument: Option<OsString>,
    current_dir: std::io::Result<PathBuf>,
) -> Result<PathBuf, ErrorPayload> {
    let explicit = repo_env
        .filter(|value| !value.is_empty())
        .or(first_argument.filter(|value| !value.is_empty()));
    match explicit {
        Some(path) => Ok(PathBuf::from(path)),
        None => current_dir.map_err(|error| {
            ErrorPayload::internal(format!("cannot read the current directory: {error}"))
        }),
    }
}

fn log_outcome<T>(
    command: &str,
    result: &Result<T, ErrorPayload>,
    summary: impl FnOnce(&T) -> String,
) {
    match result {
        Ok(value) => log::debug!("{command} ok {}", summary(value)),
        Err(error) => log::debug!("{command} failed kind={:?}: {}", error.kind, error.message),
    }
}

fn hunk_label(hunk: &DiffHunk) -> String {
    format!(
        "-{},{} +{},{}",
        hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
    )
}

fn integration_plan<T: 'static>(
    verb: &'static str,
    path: String,
    stopped: fn(&T) -> bool,
) -> impl FnOnce(yforge_core::RepoState, &T) -> Result<Planned, CoreError> + Send + 'static {
    move |before, outcome| {
        let after = yforge_core::capture_state(Path::new(&path))?;
        Ok(yforge_core::plan_integration(
            verb,
            &before,
            &after,
            stopped(outcome),
        ))
    }
}

fn state_of(
    path: &str,
) -> impl FnOnce() -> Result<yforge_core::RepoState, CoreError> + Send + 'static {
    let path = path.to_owned();
    move || yforge_core::capture_state(Path::new(&path))
}

fn conflicted(outcome: &OperationOutcome) -> bool {
    *outcome == OperationOutcome::Conflicts
}

fn stopped(result: &RebaseResult) -> bool {
    result.outcome != RebaseOutcome::Completed
}
fn recorder<'a, R: Runtime>(
    app: &AppHandle<R>,
    log: &'a State<'_, ActivityLog>,
) -> Recorder<'a, R> {
    Recorder {
        app: app.clone(),
        log: log.inner(),
    }
}

fn network<'a, R: Runtime>(
    app: &AppHandle<R>,
    log: &'a State<'_, ActivityLog>,
    operations: &'a State<'_, Operations>,
) -> Network<'a, R> {
    Network {
        recorder: recorder(app, log),
        registry: &operations.running,
        prompts: &operations.prompts,
    }
}

fn data_dir(state: &State<'_, DataDir>) -> PathBuf {
    state.0.clone()
}

#[tauri::command]
async fn app_info() -> Result<AppInfo, ErrorPayload> {
    blocking(|| yforge_core::app_info(env!("CARGO_PKG_VERSION"))).await
}

#[tauri::command]
async fn launch_path() -> Result<String, ErrorPayload> {
    choose_launch_path(
        std::env::var_os(REPO_ENV),
        std::env::args_os().nth(1),
        std::env::current_dir(),
    )
    .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn repo_open(path: String) -> Result<RepoSnapshot, ErrorPayload> {
    log::debug!("repo_open path={path}");
    note_repository(&path);
    let result = blocking(move || yforge_core::repo_snapshot(Path::new(&path))).await;
    log_outcome("repo_open", &result, |snapshot| {
        format!(
            "root={} files={} branches={} worktrees={}",
            snapshot.root,
            snapshot.files.len(),
            snapshot.branches.len(),
            snapshot.worktrees.len()
        )
    });
    result
}

#[tauri::command]
async fn repo_graph(path: String, offset: u32, limit: u32) -> Result<GraphPage, ErrorPayload> {
    log::debug!("repo_graph path={path} offset={offset} limit={limit}");
    let result = blocking(move || {
        yforge_core::graph_page(Path::new(&path), offset as usize, limit as usize)
    })
    .await;
    log_outcome("repo_graph", &result, |page| {
        format!("rows={} total={}", page.rows.len(), page.total)
    });
    result
}

#[tauri::command]
async fn search_commits(path: String, query: String) -> Result<SearchResult, ErrorPayload> {
    log::debug!(
        "search_commits path={path} query_chars={}",
        query.chars().count()
    );
    let result = blocking(move || yforge_core::search_commits(Path::new(&path), &query)).await;
    log_outcome("search_commits", &result, |found| {
        format!("matches={} total={}", found.rows.len(), found.total)
    });
    result
}

#[tauri::command]
async fn diff_file(
    path: String,
    file: String,
    area: ChangeArea,
    ignore_whitespace: Option<bool>,
) -> Result<FileDiff, ErrorPayload> {
    log::debug!(
        "diff_file path={path} file={file} area={area:?} ignore_whitespace={ignore_whitespace:?}"
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let result =
        blocking(move || yforge_core::diff_file(Path::new(&path), &file, area, ignore)).await;
    log_outcome("diff_file", &result, |diff| {
        format!("hunks={} binary={}", diff.hunks.len(), diff.binary)
    });
    result
}

#[tauri::command]
async fn stage_files<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    files: Vec<String>,
) -> Result<(), ErrorPayload> {
    log::debug!("stage_files path={path} files={files:?}");
    let count = files.len();
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Stage, false, false),
            move |()| format!("Staged {}", counted(count, "file")),
            move || yforge_core::stage_files(Path::new(&target), &files),
        )
        .await;
    log_outcome("stage_files", &result, |()| String::new());
    result
}

#[tauri::command]
async fn unstage_files<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    files: Vec<String>,
) -> Result<(), ErrorPayload> {
    log::debug!("unstage_files path={path} files={files:?}");
    let count = files.len();
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Unstage, false, false),
            move |()| format!("Unstaged {}", counted(count, "file")),
            move || yforge_core::unstage_files(Path::new(&target), &files),
        )
        .await;
    log_outcome("unstage_files", &result, |()| String::new());
    result
}

#[tauri::command]
async fn stage_all<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
) -> Result<(), ErrorPayload> {
    log::debug!("stage_all path={path}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::StageAll, false, false),
            |()| "Staged all changes".to_owned(),
            move || yforge_core::stage_all(Path::new(&target)),
        )
        .await;
    log_outcome("stage_all", &result, |()| String::new());
    result
}

#[tauri::command]
async fn unstage_all<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
) -> Result<(), ErrorPayload> {
    log::debug!("unstage_all path={path}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::UnstageAll, false, false),
            |()| "Unstaged all changes".to_owned(),
            move || yforge_core::unstage_all(Path::new(&target)),
        )
        .await;
    log_outcome("unstage_all", &result, |()| String::new());
    result
}

type Snapshot = Result<Vec<yforge_core::SnapshotFile>, String>;

fn discard_plan(
    path: String,
) -> impl FnOnce(Snapshot, &()) -> Result<Planned, CoreError> + Send + 'static {
    move |snapshot, ()| match snapshot {
        Ok(files) => yforge_core::plan_discard(Path::new(&path), files),
        Err(reason) => Ok(Planned::Unavailable(format!(
            "The discarded content could not be snapshotted: {reason}"
        ))),
    }
}

fn snapshot_of(
    path: &str,
    files: Vec<String>,
) -> impl FnOnce() -> Result<Snapshot, CoreError> + Send + 'static {
    let path = path.to_owned();
    move || {
        Ok(
            yforge_core::snapshot_files(Path::new(&path), &files)
                .map_err(|error| error.to_string()),
        )
    }
}

#[tauri::command]
async fn discard_files<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    files: Vec<String>,
) -> Result<(), ErrorPayload> {
    log::debug!("discard_files path={path} files={files:?}");
    let count = files.len();
    let target = path.clone();
    let listed = files.clone();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Discard, true, true),
            move |()| format!("Discarded changes in {}", counted(count, "file")),
            snapshot_of(&path, listed),
            move || yforge_core::discard_files(Path::new(&target), &files),
            discard_plan(path.clone()),
        )
        .await;
    log_outcome("discard_files", &result, |()| String::new());
    result
}

#[tauri::command]
async fn stage_hunk<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    hunk: DiffHunk,
    ignore_whitespace: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "stage_hunk path={path} file={file} hunk={} ignore_whitespace={ignore_whitespace:?}",
        hunk_label(&hunk)
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::StageHunk, false, false),
            move |()| format!("Staged a hunk of {name}"),
            move || yforge_core::stage_hunk(Path::new(&target), &file, &hunk, ignore),
        )
        .await;
    log_outcome("stage_hunk", &result, |()| String::new());
    result
}

#[tauri::command]
async fn unstage_hunk<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    hunk: DiffHunk,
    ignore_whitespace: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "unstage_hunk path={path} file={file} hunk={} ignore_whitespace={ignore_whitespace:?}",
        hunk_label(&hunk)
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::UnstageHunk, false, false),
            move |()| format!("Unstaged a hunk of {name}"),
            move || yforge_core::unstage_hunk(Path::new(&target), &file, &hunk, ignore),
        )
        .await;
    log_outcome("unstage_hunk", &result, |()| String::new());
    result
}

#[tauri::command]
async fn discard_hunk<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    hunk: DiffHunk,
    ignore_whitespace: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "discard_hunk path={path} file={file} hunk={} ignore_whitespace={ignore_whitespace:?}",
        hunk_label(&hunk)
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let target = path.clone();
    let name = file.clone();
    let listed = vec![file.clone()];
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::DiscardHunk, true, true),
            move |()| format!("Discarded a hunk of {name}"),
            snapshot_of(&path, listed),
            move || yforge_core::discard_hunk(Path::new(&target), &file, &hunk, ignore),
            discard_plan(path.clone()),
        )
        .await;
    log_outcome("discard_hunk", &result, |()| String::new());
    result
}

#[tauri::command]
async fn commit<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    summary: String,
    description: String,
    amend: bool,
) -> Result<String, ErrorPayload> {
    log::debug!(
        "commit path={path} summary={summary:?} description_bytes={} amend={amend}",
        description.len()
    );
    let target = path.clone();
    let planned = path.clone();
    let result = recorder(&app, &log)
        .tracked(
            track(
                &path,
                if amend {
                    OperationKind::Amend
                } else {
                    OperationKind::Commit
                },
                true,
                true,
            ),
            move |sha: &String| {
                format!(
                    "{} {}",
                    if amend { "Amended" } else { "Committed" },
                    short(sha)
                )
            },
            state_of(&path),
            move || yforge_core::commit(Path::new(&target), &summary, &description, amend),
            move |before, _| {
                let after = yforge_core::capture_state(Path::new(&planned))?;
                Ok(yforge_core::plan_commit(&before, &after, amend))
            },
        )
        .await;
    log_outcome("commit", &result, |sha| format!("sha={sha}"));
    result
}

#[tauri::command]
async fn amend_info(path: String) -> Result<AmendInfo, ErrorPayload> {
    log::debug!("amend_info path={path}");
    let result = blocking(move || yforge_core::amend_info(Path::new(&path))).await;
    log_outcome("amend_info", &result, |info| {
        format!("sha={} pushed={}", info.sha, info.pushed)
    });
    result
}

#[tauri::command]
async fn commit_details(path: String, sha: String) -> Result<CommitDetails, ErrorPayload> {
    log::debug!("commit_details path={path} sha={sha}");
    let result = blocking(move || yforge_core::commit_details(Path::new(&path), &sha)).await;
    log_outcome("commit_details", &result, |details| {
        format!(
            "sha={} parents={} refs={} files={}",
            details.sha,
            details.parents.len(),
            details.refs.len(),
            details.files.len()
        )
    });
    result
}

#[tauri::command]
async fn commit_file_diff(
    path: String,
    sha: String,
    file: String,
) -> Result<FileDiff, ErrorPayload> {
    log::debug!("commit_file_diff path={path} sha={sha} file={file}");
    let result =
        blocking(move || yforge_core::commit_file_diff(Path::new(&path), &sha, &file)).await;
    log_outcome("commit_file_diff", &result, |diff| {
        format!("hunks={} binary={}", diff.hunks.len(), diff.binary)
    });
    result
}

#[tauri::command]
async fn checkout<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    data: State<'_, DataDir>,
    path: String,
    target: CheckoutTarget,
    stash: bool,
    leave_stashed: Option<bool>,
) -> Result<CheckoutOutcome, ErrorPayload> {
    log::debug!(
        "checkout path={path} target={target:?} stash={stash} leave_stashed={leave_stashed:?}"
    );
    let leave_in = (stash && leave_stashed.unwrap_or(false)).then(|| data_dir(&data));
    let label = checkout_label(&target);
    let location = path.clone();
    let planned = path.clone();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Checkout, true, true),
            move |_: &CheckoutOutcome| format!("Switched to {label}"),
            {
                let path = path.clone();
                move || yforge_core::head_ref(Path::new(&path))
            },
            move || match &leave_in {
                Some(dir) => {
                    yforge_core::checkout_leaving_stash(Path::new(&location), &target, dir)
                }
                None => yforge_core::checkout(Path::new(&location), &target, stash),
            },
            move |before, outcome| {
                let after = yforge_core::head_ref(Path::new(&planned))?;
                let kept = matches!(
                    outcome.auto_stash,
                    yforge_core::AutoStash::Conflicts | yforge_core::AutoStash::Kept
                );
                Ok(yforge_core::plan_checkout(&before, &after, kept))
            },
        )
        .await;
    log_outcome("checkout", &result, |outcome| {
        format!("auto_stash={:?}", outcome.auto_stash)
    });
    result
}

#[tauri::command]
async fn check_branch_name(path: String, name: String) -> Result<String, ErrorPayload> {
    log::debug!("check_branch_name path={path} name={name:?}");
    let result = blocking(move || yforge_core::check_branch_name(Path::new(&path), &name)).await;
    log_outcome("check_branch_name", &result, |name| format!("name={name}"));
    result
}

#[tauri::command]
async fn create_branch<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
    at: Option<String>,
    checkout: bool,
) -> Result<(), ErrorPayload> {
    log::debug!("create_branch path={path} name={name} at={at:?} checkout={checkout}");
    let target = path.clone();
    let planned = path.clone();
    let (created, label) = (name.clone(), name.clone());
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::CreateBranch, true, true),
            move |()| format!("Created branch {label}"),
            {
                let path = path.clone();
                move || yforge_core::head_ref(Path::new(&path))
            },
            move || yforge_core::create_branch(Path::new(&target), &name, at.as_deref(), checkout),
            move |before, ()| {
                let tip = yforge_core::branch_snapshot(Path::new(&planned), &created)?
                    .map(|snapshot| snapshot.sha)
                    .unwrap_or_default();
                Ok(yforge_core::plan_branch_create(
                    &created, &tip, &before, checkout,
                ))
            },
        )
        .await;
    log_outcome("create_branch", &result, |()| String::new());
    result
}

#[tauri::command]
async fn rename_branch<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    from: String,
    to: String,
) -> Result<(), ErrorPayload> {
    log::debug!("rename_branch path={path} from={from} to={to}");
    let target = path.clone();
    let label = format!("Renamed branch {from} to {to}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::RenameBranch, true, true),
            move |()| label,
            move || yforge_core::rename_branch(Path::new(&target), &from, &to),
        )
        .await;
    log_outcome("rename_branch", &result, |()| String::new());
    result
}

#[tauri::command]
async fn branch_delete_preview(
    path: String,
    name: String,
) -> Result<Vec<CommitBrief>, ErrorPayload> {
    log::debug!("branch_delete_preview path={path} name={name}");
    let result =
        blocking(move || yforge_core::branch_delete_preview(Path::new(&path), &name)).await;
    log_outcome("branch_delete_preview", &result, |lost| {
        format!("lost={}", lost.len())
    });
    result
}

#[tauri::command]
async fn delete_branch<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
    force: bool,
) -> Result<(), ErrorPayload> {
    log::debug!("delete_branch path={path} name={name} force={force}");
    let target = path.clone();
    let (removed, label) = (name.clone(), name.clone());
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::DeleteBranch, true, true),
            move |()| format!("Deleted branch {label}"),
            {
                let (path, name) = (path.clone(), name.clone());
                move || yforge_core::branch_snapshot(Path::new(&path), &name)
            },
            move || yforge_core::delete_branch(Path::new(&target), &name, force),
            move |snapshot, ()| {
                Ok(match snapshot {
                    Some(snapshot) => yforge_core::plan_branch_delete(&removed, &snapshot),
                    None => {
                        Planned::Unavailable("The branch was not found before deleting".to_owned())
                    }
                })
            },
        )
        .await;
    log_outcome("delete_branch", &result, |()| String::new());
    result
}

#[tauri::command]
async fn stash_push<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    message: String,
    untracked: bool,
) -> Result<(), ErrorPayload> {
    log::debug!("stash_push path={path} message={message:?} untracked={untracked}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Stash, true, true),
            |()| "Stashed changes".to_owned(),
            move || yforge_core::stash_push(Path::new(&target), &message, untracked),
        )
        .await;
    log_outcome("stash_push", &result, |()| String::new());
    result
}

async fn restore_stash<R: Runtime>(
    app: &AppHandle<R>,
    log: &State<'_, ActivityLog>,
    path: String,
    index: u32,
    sha: String,
    pop: bool,
) -> Result<StashRestore, ErrorPayload> {
    let target = path.clone();
    let planned = path.clone();
    let stash = sha.clone();
    let verb = if pop {
        OperationKind::PopStash
    } else {
        OperationKind::ApplyStash
    };
    recorder(app, log)
        .tracked(
            track(&path, verb, true, true),
            move |_: &StashRestore| {
                format!(
                    "{} stash@{{{index}}}",
                    if pop { "Popped" } else { "Applied" }
                )
            },
            state_of(&path),
            move || {
                if pop {
                    yforge_core::stash_pop(Path::new(&target), index, &sha)
                } else {
                    yforge_core::stash_apply(Path::new(&target), index, &sha)
                }
            },
            move |before, restore| {
                if *restore != StashRestore::Applied {
                    return Ok(Planned::Unavailable(
                        "The stash applied with conflicts; resolve them instead".to_owned(),
                    ));
                }
                yforge_core::plan_stash_restore(Path::new(&planned), &stash, pop, &before)
            },
        )
        .await
}

#[tauri::command]
async fn stash_apply<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    index: u32,
    sha: String,
) -> Result<StashRestore, ErrorPayload> {
    log::debug!("stash_apply path={path} index={index} sha={sha}");
    let result = restore_stash(&app, &log, path, index, sha, false).await;
    log_outcome("stash_apply", &result, |restore| format!("{restore:?}"));
    result
}

#[tauri::command]
async fn stash_pop<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    index: u32,
    sha: String,
) -> Result<StashRestore, ErrorPayload> {
    log::debug!("stash_pop path={path} index={index} sha={sha}");
    let result = restore_stash(&app, &log, path, index, sha, true).await;
    log_outcome("stash_pop", &result, |restore| format!("{restore:?}"));
    result
}

#[tauri::command]
async fn stash_drop<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    index: u32,
    sha: String,
) -> Result<(), ErrorPayload> {
    log::debug!("stash_drop path={path} index={index} sha={sha}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::DropStash, true, true),
            move |()| format!("Dropped stash@{{{index}}}"),
            move || yforge_core::stash_drop(Path::new(&target), index, &sha),
        )
        .await;
    log_outcome("stash_drop", &result, |()| String::new());
    result
}

#[tauri::command]
async fn fetch<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    prune: bool,
    interactive: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!("fetch path={path} id={id} prune={prune} interactive={interactive:?}");
    let meta = track(&path, OperationKind::Fetch, false, false);
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            interactive.unwrap_or(true),
            |()| "Fetched all remotes".to_owned(),
            move |cancel, progress| yforge_core::fetch(Path::new(&path), prune, cancel, progress),
        )
        .await;
    log_outcome("fetch", &result, |()| String::new());
    result
}

#[tauri::command]
async fn pull<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    mode: PullMode,
) -> Result<PullOutcome, ErrorPayload> {
    log::debug!("pull path={path} id={id} mode={mode:?}");
    let meta = track(&path, OperationKind::Pull, false, true);
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            |outcome: &PullOutcome| format!("Pull: {outcome:?}"),
            move |cancel, progress| yforge_core::pull(Path::new(&path), mode, cancel, progress),
        )
        .await;
    log_outcome("pull", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
async fn push<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
) -> Result<(), ErrorPayload> {
    log::debug!("push path={path} id={id}");
    let meta = track(&path, OperationKind::Push, false, true);
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            |()| "Pushed the current branch".to_owned(),
            move |cancel, progress| yforge_core::push(Path::new(&path), cancel, progress),
        )
        .await;
    log_outcome("push", &result, |()| String::new());
    result
}

#[tauri::command]
async fn publish<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    remote: String,
) -> Result<(), ErrorPayload> {
    log::debug!("publish path={path} id={id} remote={remote}");
    let meta = track(&path, OperationKind::Publish, false, true);
    let label = format!("Published the branch to {remote}");
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            move |()| label,
            move |cancel, progress| {
                yforge_core::publish(Path::new(&path), &remote, cancel, progress)
            },
        )
        .await;
    log_outcome("publish", &result, |()| String::new());
    result
}

#[tauri::command]
async fn push_plan(path: String) -> Result<ForcePushPlan, ErrorPayload> {
    log::debug!("push_plan path={path}");
    let result = blocking(move || yforge_core::push_plan(Path::new(&path))).await;
    log_outcome("push_plan", &result, |plan| {
        format!(
            "upstream={} expected={} replaced={}",
            plan.upstream,
            plan.lease.expected_sha,
            plan.replaced.len()
        )
    });
    result
}

#[tauri::command]
async fn push_force<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    lease: ForceLease,
) -> Result<(), ErrorPayload> {
    log::debug!("push_force path={path} id={id} lease={lease:?}");
    let meta = track(&path, OperationKind::ForcePush, true, true);
    let label = format!("Force pushed {}", lease.branch);
    let prepared = (path.clone(), lease.branch.clone());
    let planned = lease.clone();
    let result = network(&app, &log, &operations)
        .run_planned(
            meta,
            id,
            true,
            move |()| label,
            move |cancel, progress| {
                yforge_core::push_force(Path::new(&path), &lease, cancel, progress)
            },
            (
                move || {
                    let (path, branch) = prepared;
                    Ok(yforge_core::branch_snapshot(Path::new(&path), &branch)?
                        .map(|snapshot| snapshot.sha))
                },
                move |pushed, ()| {
                    Ok(match pushed {
                        Some(pushed) => yforge_core::plan_force_push(&planned, &pushed),
                        None => Planned::Unavailable(
                            "The local branch no longer exists, so the pushed commit is unknown"
                                .to_owned(),
                        ),
                    })
                },
            ),
        )
        .await;
    log_outcome("push_force", &result, |()| String::new());
    result
}

#[tauri::command]
fn operation_cancel(operations: State<'_, Operations>, id: String) -> bool {
    let found = operations.running.cancel(&id);
    operations.prompts.cancel_operation(&id);
    log::debug!("operation_cancel id={id} found={found}");
    found
}

#[tauri::command]
fn auth_respond(operations: State<'_, Operations>, id: String, reply: AuthReply) -> bool {
    let name = auth::reply_name(&reply);
    let delivered = operations.prompts.respond(&id, reply);
    log::debug!("auth_respond id={id} reply={name} delivered={delivered}");
    delivered
}

#[tauri::command]
async fn operation_continue<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    message: Option<String>,
) -> Result<OperationOutcome, ErrorPayload> {
    log::debug!("operation_continue path={path} message={message:?}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Continue, true, true),
            |outcome: &OperationOutcome| format!("Continue: {outcome:?}"),
            move || yforge_core::operation_continue(Path::new(&target), message.as_deref()),
        )
        .await;
    log_outcome("operation_continue", &result, |outcome| {
        format!("{outcome:?}")
    });
    result
}

#[tauri::command]
async fn operation_skip<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
) -> Result<OperationOutcome, ErrorPayload> {
    log::debug!("operation_skip path={path}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Skip, true, true),
            |outcome: &OperationOutcome| format!("Skip: {outcome:?}"),
            move || yforge_core::operation_skip(Path::new(&target)),
        )
        .await;
    log_outcome("operation_skip", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
async fn operation_abort<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
) -> Result<(), ErrorPayload> {
    log::debug!("operation_abort path={path}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Abort, true, true),
            |()| "Aborted the operation".to_owned(),
            move || yforge_core::operation_abort(Path::new(&target)),
        )
        .await;
    log_outcome("operation_abort", &result, |()| String::new());
    result
}

#[tauri::command]
async fn mark_resolved<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    files: Vec<String>,
) -> Result<(), ErrorPayload> {
    log::debug!("mark_resolved path={path} files={files:?}");
    let count = files.len();
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::MarkResolved, false, false),
            move |()| format!("Marked {} resolved", counted(count, "file")),
            move || yforge_core::mark_resolved(Path::new(&target), &files),
        )
        .await;
    log_outcome("mark_resolved", &result, |()| String::new());
    result
}

#[tauri::command]
async fn integration_preview(
    path: String,
    base: Option<String>,
    other: String,
) -> Result<IntegrationPreview, ErrorPayload> {
    log::debug!("integration_preview path={path} base={base:?} other={other}");
    let result = blocking(move || {
        yforge_core::integration_preview(Path::new(&path), base.as_deref(), &other)
    })
    .await;
    log_outcome("integration_preview", &result, |preview| {
        format!(
            "incoming={} outgoing={} fast_forward={}",
            preview.incoming.count, preview.outgoing.count, preview.fast_forward
        )
    });
    result
}

#[tauri::command]
async fn merge<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    source: String,
    mode: MergeMode,
) -> Result<OperationOutcome, ErrorPayload> {
    log::debug!("merge path={path} source={source} mode={mode:?}");
    let target = path.clone();
    let label = format!("Merged {source}");
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Merge, true, true),
            move |_: &OperationOutcome| label,
            state_of(&path),
            move || yforge_core::merge(Path::new(&target), &source, mode),
            integration_plan("merge", path.clone(), conflicted),
        )
        .await;
    log_outcome("merge", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
async fn rebase<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    onto: String,
) -> Result<OperationOutcome, ErrorPayload> {
    log::debug!("rebase path={path} onto={onto}");
    let target = path.clone();
    let label = format!("Rebased onto {onto}");
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Rebase, true, true),
            move |_: &OperationOutcome| label,
            state_of(&path),
            move || yforge_core::rebase(Path::new(&target), &onto),
            integration_plan("rebase", path.clone(), conflicted),
        )
        .await;
    log_outcome("rebase", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
async fn rebase_plan(path: String, base: String) -> Result<RebasePlan, ErrorPayload> {
    log::debug!("rebase_plan path={path} base={base}");
    let result = blocking(move || yforge_core::rebase_plan(Path::new(&path), &base)).await;
    log_outcome("rebase_plan", &result, |plan| {
        format!("commits={} pushed={}", plan.commits.len(), plan.pushed)
    });
    result
}

#[tauri::command]
async fn rebase_interactive<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    base: String,
    steps: Vec<RebaseStep>,
) -> Result<RebaseResult, ErrorPayload> {
    log::debug!(
        "rebase_interactive path={path} base={base} steps={}",
        steps.len()
    );
    let target = path.clone();
    let count = steps.len();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::InteractiveRebase, true, true),
            move |result: &RebaseResult| {
                format!(
                    "Rewrote history with {}: {:?}",
                    counted(count, "step"),
                    result.outcome
                )
            },
            state_of(&path),
            move || yforge_core::rebase_interactive(Path::new(&target), &base, &steps),
            integration_plan("interactive rebase", path.clone(), stopped),
        )
        .await;
    log_outcome("rebase_interactive", &result, |result| {
        format!("{:?} pushed={}", result.outcome, result.pushed)
    });
    result
}

#[tauri::command]
async fn squash_commits<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    shas: Vec<String>,
    message: String,
) -> Result<RebaseResult, ErrorPayload> {
    log::debug!("squash_commits path={path} shas={shas:?}");
    let target = path.clone();
    let count = shas.len();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::SquashCommits, true, true),
            move |result: &RebaseResult| {
                format!(
                    "Squashed {}: {:?}",
                    counted(count, "commit"),
                    result.outcome
                )
            },
            state_of(&path),
            move || yforge_core::squash_commits(Path::new(&target), &shas, &message),
            integration_plan("squash", path.clone(), stopped),
        )
        .await;
    log_outcome("squash_commits", &result, |result| {
        format!("{:?} pushed={}", result.outcome, result.pushed)
    });
    result
}

#[tauri::command]
async fn recompose_preview(path: String, base: String) -> Result<RecomposePreview, ErrorPayload> {
    log::debug!("recompose_preview path={path} base={base}");
    let result = blocking(move || yforge_core::recompose_preview(Path::new(&path), &base)).await;
    log_outcome("recompose_preview", &result, |preview| {
        format!("files={} pushed={}", preview.files.len(), preview.pushed)
    });
    result
}

#[tauri::command]
async fn recompose_apply<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    base: String,
    groups: Vec<RecomposeGroup>,
) -> Result<RecomposeResult, ErrorPayload> {
    log::debug!(
        "recompose_apply path={path} base={base} groups={}",
        groups.len()
    );
    let target = path.clone();
    let count = groups.len();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Recompose, true, true),
            move |result: &RecomposeResult| {
                format!(
                    "Recomposed into {} ending at {}",
                    counted(count, "commit"),
                    short(&result.head)
                )
            },
            state_of(&path),
            move || yforge_core::recompose_apply(Path::new(&target), &base, &groups),
            integration_plan("recompose", path.clone(), |_: &RecomposeResult| false),
        )
        .await;
    log_outcome("recompose_apply", &result, |result| {
        format!("head={} pushed={}", result.head, result.pushed)
    });
    result
}

#[tauri::command]
async fn fast_forward<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    branch: String,
    target: String,
) -> Result<(), ErrorPayload> {
    log::debug!("fast_forward path={path} branch={branch} target={target}");
    let location = path.clone();
    let label = format!("Fast-forwarded {branch} to {target}");
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::FastForward, true, true),
            move |()| label,
            state_of(&path),
            move || yforge_core::fast_forward(Path::new(&location), &branch, &target),
            integration_plan("fast-forward", path.clone(), |()| false),
        )
        .await;
    log_outcome("fast_forward", &result, |()| String::new());
    result
}

#[tauri::command]
async fn cherry_pick<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    sha: String,
) -> Result<OperationOutcome, ErrorPayload> {
    log::debug!("cherry_pick path={path} sha={sha}");
    let target = path.clone();
    let label = format!("Cherry-picked {}", short(&sha));
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::CherryPick, true, true),
            move |_: &OperationOutcome| label,
            state_of(&path),
            move || yforge_core::cherry_pick(Path::new(&target), &sha),
            integration_plan("cherry-pick", path.clone(), conflicted),
        )
        .await;
    log_outcome("cherry_pick", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
async fn revert<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    sha: String,
) -> Result<OperationOutcome, ErrorPayload> {
    log::debug!("revert path={path} sha={sha}");
    let target = path.clone();
    let label = format!("Reverted {}", short(&sha));
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Revert, true, true),
            move |_: &OperationOutcome| label,
            state_of(&path),
            move || yforge_core::revert(Path::new(&target), &sha),
            integration_plan("revert", path.clone(), conflicted),
        )
        .await;
    log_outcome("revert", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
async fn reset<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    target: String,
    mode: ResetMode,
) -> Result<(), ErrorPayload> {
    log::debug!("reset path={path} target={target} mode={mode:?}");
    let location = path.clone();
    let planned = path.clone();
    let label = format!("Reset ({mode:?}) to {}", short(&target));
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::Reset, true, true),
            move |()| label,
            state_of(&path),
            move || yforge_core::reset(Path::new(&location), &target, mode),
            move |before, ()| {
                let after = yforge_core::capture_state(Path::new(&planned))?;
                Ok(yforge_core::plan_reset(&before, &after, mode))
            },
        )
        .await;
    log_outcome("reset", &result, |()| String::new());
    result
}

#[tauri::command]
async fn create_tag<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
    at: Option<String>,
    message: Option<String>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "create_tag path={path} name={name} at={at:?} annotated={}",
        message.is_some()
    );
    let target = path.clone();
    let label = format!("Created tag {name}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::CreateTag, true, true),
            move |()| label,
            move || {
                yforge_core::create_tag(
                    Path::new(&target),
                    &name,
                    at.as_deref(),
                    message.as_deref(),
                )
            },
        )
        .await;
    log_outcome("create_tag", &result, |()| String::new());
    result
}

#[tauri::command]
async fn delete_tag<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
) -> Result<(), ErrorPayload> {
    log::debug!("delete_tag path={path} name={name}");
    let target = path.clone();
    let label = format!("Deleted tag {name}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::DeleteTag, true, true),
            move |()| label,
            move || yforge_core::delete_tag(Path::new(&target), &name),
        )
        .await;
    log_outcome("delete_tag", &result, |()| String::new());
    result
}

#[tauri::command]
async fn push_tag<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    remote: String,
    name: String,
) -> Result<(), ErrorPayload> {
    log::debug!("push_tag path={path} id={id} remote={remote} name={name}");
    let meta = track(&path, OperationKind::PushTag, false, true);
    let label = format!("Pushed tag {name} to {remote}");
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            move |()| label,
            move |cancel, progress| {
                yforge_core::push_tag(Path::new(&path), &remote, &name, cancel, progress)
            },
        )
        .await;
    log_outcome("push_tag", &result, |()| String::new());
    result
}

#[tauri::command]
async fn delete_remote_tag<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    remote: String,
    name: String,
) -> Result<(), ErrorPayload> {
    log::debug!("delete_remote_tag path={path} id={id} remote={remote} name={name}");
    let meta = track(&path, OperationKind::DeleteRemoteTag, false, true);
    let label = format!("Deleted tag {name} from {remote}");
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            move |()| label,
            move |cancel, progress| {
                yforge_core::delete_remote_tag(Path::new(&path), &remote, &name, cancel, progress)
            },
        )
        .await;
    log_outcome("delete_remote_tag", &result, |()| String::new());
    result
}

#[tauri::command]
async fn conflict_file(path: String, file: String) -> Result<ConflictFile, ErrorPayload> {
    log::debug!("conflict_file path={path} file={file}");
    let result = blocking(move || yforge_core::conflict_file(Path::new(&path), &file)).await;
    log_outcome("conflict_file", &result, |conflict| {
        format!(
            "segments={} binary={} eol={:?}",
            conflict.segments.len(),
            conflict.binary,
            conflict.eol
        )
    });
    result
}

#[tauri::command]
async fn conflict_resolve<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    content: String,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "conflict_resolve path={path} file={file} content_bytes={}",
        content.len()
    );
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::ResolveConflict, false, false),
            move |()| format!("Resolved {name}"),
            move || yforge_core::conflict_resolve(Path::new(&target), &file, &content),
        )
        .await;
    log_outcome("conflict_resolve", &result, |()| String::new());
    result
}

#[tauri::command]
async fn conflict_take_side<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    side: ConflictSide,
) -> Result<(), ErrorPayload> {
    log::debug!("conflict_take_side path={path} file={file} side={side:?}");
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::TakeSide, false, false),
            move |()| format!("Took a side of {name}"),
            move || yforge_core::conflict_take_side(Path::new(&target), &file, side),
        )
        .await;
    log_outcome("conflict_take_side", &result, |()| String::new());
    result
}

#[tauri::command]
async fn conflict_reset<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
) -> Result<(), ErrorPayload> {
    log::debug!("conflict_reset path={path} file={file}");
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::ResetConflict, false, false),
            move |()| format!("Reset {name}"),
            move || yforge_core::conflict_reset(Path::new(&target), &file),
        )
        .await;
    log_outcome("conflict_reset", &result, |()| String::new());
    result
}

#[tauri::command]
async fn repo_watch<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), ErrorPayload> {
    log::debug!("repo_watch path={path}");
    let announced = path.clone();
    let result = blocking(move || {
        yforge_core::watch_repo(Path::new(&path), move || {
            let payload = RepoChanged {
                path: announced.clone(),
            };
            log::debug!("repo-changed path={}", payload.path);
            if let Err(error) = app.emit(REPO_CHANGED_EVENT, payload) {
                log::warn!("could not emit {REPO_CHANGED_EVENT}: {error}");
            }
        })
    })
    .await;
    log_outcome("repo_watch", &result, |_| String::new());
    let watcher = result?;
    *state.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(watcher);
    Ok(())
}

#[tauri::command]
async fn clone_repo<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    id: String,
    url: String,
    destination: String,
) -> Result<String, ErrorPayload> {
    log::debug!(
        "clone_repo id={id} url={} destination={destination}",
        yforge_core::redact(&url)
    );
    let meta = track(&destination, OperationKind::Clone, false, false);
    let label = format!("Cloned into {destination}");
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            move |_: &String| label,
            move |cancel, progress| {
                yforge_core::clone_repository(&url, Path::new(&destination), cancel, progress)
            },
        )
        .await;
    log_outcome("clone_repo", &result, |root| format!("root={root}"));
    result
}

#[tauri::command]
async fn init_repo<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    data: State<'_, DataDir>,
    path: String,
) -> Result<String, ErrorPayload> {
    log::debug!("init_repo path={path}");
    let dir = data_dir(&data);
    let label = format!("Initialized a repository in {path}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::Initialize, false, false),
            move |_: &String| label,
            move || {
                let settings = yforge_core::load_settings(&dir)?;
                yforge_core::init_repository(Path::new(&target), &settings.default_branch)
            },
        )
        .await;
    log_outcome("init_repo", &result, |root| format!("root={root}"));
    result
}

#[tauri::command]
async fn settings_load(data: State<'_, DataDir>) -> Result<AppSettings, ErrorPayload> {
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::load_settings(&dir)).await;
    log_outcome("settings_load", &result, |settings| format!("{settings:?}"));
    result
}

#[tauri::command]
async fn settings_save(
    data: State<'_, DataDir>,
    settings: AppSettings,
) -> Result<AppSettings, ErrorPayload> {
    log::debug!("settings_save {settings:?}");
    let dir = data_dir(&data);
    let result = blocking(move || {
        yforge_core::save_settings(&dir, &settings)?;
        yforge_core::load_settings(&dir)
    })
    .await;
    log_outcome("settings_save", &result, |_| String::new());
    result
}

#[tauri::command]
async fn repo_settings_load(
    data: State<'_, DataDir>,
    path: String,
) -> Result<RepoSettings, ErrorPayload> {
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::load_repo_settings(&dir, &path)).await;
    log_outcome("repo_settings_load", &result, |settings| {
        format!("{settings:?}")
    });
    result
}

#[tauri::command]
async fn repo_settings_save(
    data: State<'_, DataDir>,
    path: String,
    settings: RepoSettings,
) -> Result<(), ErrorPayload> {
    log::debug!("repo_settings_save path={path} {settings:?}");
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::save_repo_settings(&dir, &path, &settings)).await;
    log_outcome("repo_settings_save", &result, |()| String::new());
    result
}

#[tauri::command]
async fn identity_read(path: Option<String>) -> Result<Identity, ErrorPayload> {
    log::debug!("identity_read path={path:?}");
    let result = blocking(move || yforge_core::read_identity(path.as_deref().map(Path::new))).await;
    log_outcome("identity_read", &result, |identity| {
        format!(
            "name={:?} email={:?}",
            identity.name.source, identity.email.source
        )
    });
    result
}

#[tauri::command]
async fn identity_write<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: Option<String>,
    field: IdentityField,
    value: Option<String>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "identity_write path={path:?} field={field:?} set={}",
        value.is_some()
    );
    let repo = path.clone().unwrap_or_default();
    let result = recorder(&app, &log)
        .recorded(
            track(&repo, OperationKind::SetIdentity, false, false),
            move |()| format!("Updated {field:?}"),
            move || {
                yforge_core::write_identity(path.as_deref().map(Path::new), field, value.as_deref())
            },
        )
        .await;
    log_outcome("identity_write", &result, |()| String::new());
    result
}

#[tauri::command]
async fn remotes_list(path: String) -> Result<Vec<RemoteInfo>, ErrorPayload> {
    log::debug!("remotes_list path={path}");
    let result = blocking(move || yforge_core::list_remotes(Path::new(&path))).await;
    log_outcome("remotes_list", &result, |remotes| {
        format!("remotes={}", remotes.len())
    });
    result
}

#[tauri::command]
async fn remote_add<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
    url: String,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "remote_add path={path} name={name} url={}",
        yforge_core::redact(&url)
    );
    let target = path.clone();
    let label = format!("Added remote {name}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::AddRemote, true, false),
            move |()| label,
            move || yforge_core::add_remote(Path::new(&target), &name, &url),
        )
        .await;
    log_outcome("remote_add", &result, |()| String::new());
    result
}

#[tauri::command]
async fn remote_edit<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
    new_name: String,
    url: String,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "remote_edit path={path} name={name} new_name={new_name} url={}",
        yforge_core::redact(&url)
    );
    let target = path.clone();
    let label = format!("Updated remote {new_name}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::EditRemote, true, false),
            move |()| label,
            move || yforge_core::edit_remote(Path::new(&target), &name, &new_name, &url),
        )
        .await;
    log_outcome("remote_edit", &result, |()| String::new());
    result
}

#[tauri::command]
async fn remote_remove<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    name: String,
) -> Result<(), ErrorPayload> {
    log::debug!("remote_remove path={path} name={name}");
    let target = path.clone();
    let label = format!("Removed remote {name}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::RemoveRemote, true, false),
            move |()| label,
            move || yforge_core::remove_remote(Path::new(&target), &name),
        )
        .await;
    log_outcome("remote_remove", &result, |()| String::new());
    result
}

#[tauri::command]
async fn recents_list(data: State<'_, DataDir>) -> Result<Vec<RecentRepo>, ErrorPayload> {
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::load_recents(&dir)).await;
    log_outcome("recents_list", &result, |recents| {
        format!("recents={}", recents.len())
    });
    result
}

#[tauri::command]
async fn recent_add(
    data: State<'_, DataDir>,
    path: String,
) -> Result<Vec<RecentRepo>, ErrorPayload> {
    log::debug!("recent_add path={path}");
    note_repository(&path);
    let dir = data_dir(&data);
    blocking(move || yforge_core::add_recent(&dir, &path)).await
}

#[tauri::command]
async fn recent_remove(
    data: State<'_, DataDir>,
    path: String,
) -> Result<Vec<RecentRepo>, ErrorPayload> {
    log::debug!("recent_remove path={path}");
    let dir = data_dir(&data);
    blocking(move || yforge_core::remove_recent(&dir, &path)).await
}

#[tauri::command]
async fn recent_statuses(paths: Vec<String>) -> Result<Vec<RecentStatus>, ErrorPayload> {
    log::debug!("recent_statuses paths={}", paths.len());
    blocking(move || {
        Ok(paths
            .iter()
            .map(|path| yforge_core::recent_status(Path::new(path)))
            .collect())
    })
    .await
}

#[tauri::command]
async fn session_load(data: State<'_, DataDir>) -> Result<TabSession, ErrorPayload> {
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::load_session(&dir)).await;
    log_outcome("session_load", &result, |session| {
        format!("tabs={}", session.tabs.len())
    });
    result
}

#[tauri::command]
async fn session_save(data: State<'_, DataDir>, session: TabSession) -> Result<(), ErrorPayload> {
    log::debug!(
        "session_save tabs={} active={}",
        session.tabs.len(),
        session.active
    );
    let dir = data_dir(&data);
    blocking(move || yforge_core::save_session(&dir, &session)).await
}

#[tauri::command]
async fn open_path(
    data: State<'_, DataDir>,
    with: OpenWith,
    path: String,
) -> Result<(), ErrorPayload> {
    log::debug!("open_path with={with:?} path={path}");
    let dir = data_dir(&data);
    let result = blocking(move || {
        let settings = yforge_core::load_settings(&dir)?;
        let is_directory = Path::new(&path).is_dir();
        let command = open::open_command(
            with,
            &settings,
            &path,
            is_directory,
            cfg!(target_os = "macos"),
        );
        Ok(command)
    })
    .await?;
    let (program, args) = result?;
    std::process::Command::new(&program)
        .args(&args)
        .spawn()
        .map(drop)
        .map_err(|error| ErrorPayload::internal(format!("could not start {program}: {error}")))
}

#[tauri::command]
fn activity_list(log: State<'_, ActivityLog>) -> Vec<ActivityEntry> {
    log.list()
}

#[tauri::command]
async fn activity_history(
    log: State<'_, ActivityLog>,
    data: State<'_, DataDir>,
    repo: String,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<ActivityEntry>, ErrorPayload> {
    let log = log.inner().clone();
    let dir = data_dir(&data);
    blocking(move || log.history(&dir, &repo, before, limit)).await
}

#[tauri::command]
async fn activity_clear(
    log: State<'_, ActivityLog>,
    data: State<'_, DataDir>,
    repo: Option<String>,
) -> Result<(), ErrorPayload> {
    let log = log.inner().clone();
    let dir = data_dir(&data);
    blocking(move || log.clear(&dir, repo.as_deref())).await
}

#[tauri::command]
async fn crash_report(data: State<'_, DataDir>, report: CrashReport) -> Result<(), ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || {
        yforge_core::record_crash(
            &dir,
            env!("CARGO_PKG_VERSION"),
            &crash::redactor(),
            &report.into(),
        )
    })
    .await
}

#[tauri::command]
async fn crash_list(
    data: State<'_, DataDir>,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<CrashRecord>, ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || yforge_core::list_crashes(&dir, before, limit)).await
}

#[tauri::command]
async fn crash_export(data: State<'_, DataDir>, path: String) -> Result<u32, ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || yforge_core::export_crashes(&dir, Path::new(&path))).await
}

#[tauri::command]
async fn crash_clear(data: State<'_, DataDir>) -> Result<(), ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || yforge_core::clear_crashes(&dir)).await
}

#[tauri::command]
async fn usage_list(
    data: State<'_, DataDir>,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<UsageRecord>, ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || yforge_core::list_usage(&dir, before, limit)).await
}

#[tauri::command]
async fn usage_export(data: State<'_, DataDir>, path: String) -> Result<u32, ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || yforge_core::export_usage(&dir, Path::new(&path))).await
}

#[tauri::command]
async fn usage_clear(data: State<'_, DataDir>) -> Result<(), ErrorPayload> {
    let dir = data_dir(&data);
    blocking(move || yforge_core::delete_usage(&dir)).await
}

#[tauri::command]
async fn undo_last<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: u32,
) -> Result<String, ErrorPayload> {
    log::debug!("undo_last path={path} id={id}");
    let (operation, action) = log.undo_target(&path, id)?;
    let target = path.clone();
    let label = operation.clone();
    let result = network(&app, &log, &operations)
        .run(
            track(&path, OperationKind::Undo, false, true),
            format!("undo-{id}"),
            true,
            move |message: &String| format!("Undid {label}: {message}"),
            move |cancel, progress| {
                yforge_core::undo_with(Path::new(&target), &action, cancel, progress)
            },
        )
        .await;
    if result.is_ok() {
        log.mark_undone(&app, id);
    }
    log_outcome("undo_last", &result, |message| {
        format!("operation={operation} {message}")
    });
    result
}

#[tauri::command]
async fn stage_lines<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    hunk: DiffHunk,
    lines: Vec<u32>,
    ignore_whitespace: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "stage_lines path={path} file={file} hunk={} lines={} ignore_whitespace={ignore_whitespace:?}",
        hunk_label(&hunk),
        lines.len()
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::StageLines, false, false),
            move |()| format!("Staged lines of {name}"),
            move || yforge_core::stage_lines(Path::new(&target), &file, &hunk, &lines, ignore),
        )
        .await;
    log_outcome("stage_lines", &result, |()| String::new());
    result
}

#[tauri::command]
async fn unstage_lines<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    hunk: DiffHunk,
    lines: Vec<u32>,
    ignore_whitespace: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "unstage_lines path={path} file={file} hunk={} lines={} ignore_whitespace={ignore_whitespace:?}",
        hunk_label(&hunk),
        lines.len()
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let target = path.clone();
    let name = file.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::UnstageLines, false, false),
            move |()| format!("Unstaged lines of {name}"),
            move || yforge_core::unstage_lines(Path::new(&target), &file, &hunk, &lines, ignore),
        )
        .await;
    log_outcome("unstage_lines", &result, |()| String::new());
    result
}

#[tauri::command]
async fn discard_lines<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    file: String,
    hunk: DiffHunk,
    lines: Vec<u32>,
    ignore_whitespace: Option<bool>,
) -> Result<(), ErrorPayload> {
    log::debug!(
        "discard_lines path={path} file={file} hunk={} lines={} ignore_whitespace={ignore_whitespace:?}",
        hunk_label(&hunk),
        lines.len()
    );
    let ignore = ignore_whitespace.unwrap_or(false);
    let target = path.clone();
    let name = file.clone();
    let listed = vec![file.clone()];
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::DiscardLines, true, true),
            move |()| format!("Discarded lines of {name}"),
            snapshot_of(&path, listed),
            move || yforge_core::discard_lines(Path::new(&target), &file, &hunk, &lines, ignore),
            discard_plan(path.clone()),
        )
        .await;
    log_outcome("discard_lines", &result, |()| String::new());
    result
}

#[tauri::command]
async fn edit_head_message<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    sha: String,
    summary: String,
    description: String,
) -> Result<MessageEdit, ErrorPayload> {
    log::debug!(
        "edit_head_message path={path} sha={sha} summary={summary:?} description_bytes={}",
        description.len()
    );
    let target = path.clone();
    let planned = path.clone();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::EditMessage, true, true),
            |edit: &MessageEdit| format!("Edited the message of {}", short(&edit.sha)),
            state_of(&path),
            move || {
                yforge_core::edit_head_message(Path::new(&target), &sha, &summary, &description)
            },
            move |before, _| {
                let after = yforge_core::capture_state(Path::new(&planned))?;
                Ok(yforge_core::plan_commit(&before, &after, true))
            },
        )
        .await;
    log_outcome("edit_head_message", &result, |edit| {
        format!("sha={} pushed={}", edit.sha, edit.pushed)
    });
    result
}

#[tauri::command]
async fn delete_remote_branch<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    remote: String,
    name: String,
) -> Result<(), ErrorPayload> {
    log::debug!("delete_remote_branch path={path} id={id} remote={remote} name={name}");
    let meta = track(&path, OperationKind::DeleteRemoteBranch, true, true);
    let label = format!("Deleted {remote}/{name}");
    let prepared = (path.clone(), remote.clone(), name.clone());
    let planned = (remote.clone(), name.clone());
    let result = network(&app, &log, &operations)
        .run_planned(
            meta,
            id,
            true,
            move |()| label,
            move |cancel, progress| {
                yforge_core::delete_remote_branch(
                    Path::new(&path),
                    &remote,
                    &name,
                    cancel,
                    progress,
                )
            },
            (
                move || {
                    let (path, remote, name) = prepared;
                    yforge_core::remote_branch_sha(Path::new(&path), &remote, &name)
                },
                move |sha, ()| {
                    Ok(yforge_core::plan_remote_branch_delete(
                        &planned.0, &planned.1, sha,
                    ))
                },
            ),
        )
        .await;
    log_outcome("delete_remote_branch", &result, |()| String::new());
    result
}

#[tauri::command]
async fn set_upstream<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    branch: String,
    upstream: Option<String>,
) -> Result<(), ErrorPayload> {
    log::debug!("set_upstream path={path} branch={branch} upstream={upstream:?}");
    let target = path.clone();
    let planned = path.clone();
    let (named, label) = (
        branch.clone(),
        match &upstream {
            Some(name) => format!("{branch} now tracks {name}"),
            None => format!("{branch} no longer tracks a branch"),
        },
    );
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::SetUpstream, true, true),
            move |()| label,
            {
                let (path, branch) = (path.clone(), branch.clone());
                move || {
                    Ok(yforge_core::branch_snapshot(Path::new(&path), &branch)?
                        .and_then(|snapshot| snapshot.upstream))
                }
            },
            move || yforge_core::set_upstream(Path::new(&target), &branch, upstream.as_deref()),
            move |before, ()| {
                let after = yforge_core::branch_snapshot(Path::new(&planned), &named)?
                    .and_then(|snapshot| snapshot.upstream);
                Ok(yforge_core::plan_upstream(&named, &before, &after))
            },
        )
        .await;
    log_outcome("set_upstream", &result, |()| String::new());
    result
}

#[tauri::command]
async fn push_to<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    target: PushTarget,
) -> Result<(), ErrorPayload> {
    log::debug!("push_to path={path} id={id} target={target:?}");
    let PushTarget {
        remote,
        name,
        set_upstream,
    } = target;
    let meta = track(&path, OperationKind::PushTo, false, true);
    let label = format!("Pushed to {remote}/{name}");
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            move |()| label,
            move |cancel, progress| {
                yforge_core::push_to(
                    Path::new(&path),
                    &remote,
                    &name,
                    set_upstream,
                    cancel,
                    progress,
                )
            },
        )
        .await;
    log_outcome("push_to", &result, |()| String::new());
    result
}

#[tauri::command]
async fn stash_rename<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    index: u32,
    sha: String,
    message: String,
) -> Result<(), ErrorPayload> {
    log::debug!("stash_rename path={path} index={index} sha={sha} message={message:?}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::RenameStash, true, true),
            move |()| format!("Renamed stash@{{{index}}}"),
            move || yforge_core::stash_rename(Path::new(&target), index, &sha, &message),
        )
        .await;
    log_outcome("stash_rename", &result, |()| String::new());
    result
}

#[tauri::command]
async fn pull_with_autostash<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    mode: PullMode,
) -> Result<PullReport, ErrorPayload> {
    log::debug!("pull_with_autostash path={path} id={id} mode={mode:?}");
    let meta = track(&path, OperationKind::PullAutostash, false, true);
    let result = network(&app, &log, &operations)
        .run(
            meta,
            id,
            true,
            |report: &PullReport| format!("Pull: {:?}, stash: {:?}", report.outcome, report.stash),
            move |cancel, progress| {
                yforge_core::pull_autostash(Path::new(&path), mode, cancel, progress)
            },
        )
        .await;
    log_outcome("pull_with_autostash", &result, |report| {
        format!("{:?} {:?}", report.outcome, report.stash)
    });
    result
}

#[tauri::command]
async fn switch_stashes(
    data: State<'_, DataDir>,
    path: String,
    branch: String,
) -> Result<Vec<SwitchStash>, ErrorPayload> {
    log::debug!("switch_stashes path={path} branch={branch}");
    let dir = data_dir(&data);
    let result =
        blocking(move || yforge_core::switch_stashes(&dir, Path::new(&path), &branch)).await;
    log_outcome("switch_stashes", &result, |stashes| {
        format!("stashes={}", stashes.len())
    });
    result
}

#[tauri::command]
async fn switch_stash_restore<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    data: State<'_, DataDir>,
    path: String,
    branch: String,
    sha: String,
) -> Result<StashRestore, ErrorPayload> {
    log::debug!("switch_stash_restore path={path} branch={branch} sha={sha}");
    let dir = data_dir(&data);
    let lookup = (dir.clone(), path.clone(), branch.clone(), sha.clone());
    let index = blocking(move || {
        let (dir, path, branch, sha) = lookup;
        yforge_core::switch_stashes(&dir, Path::new(&path), &branch)?
            .into_iter()
            .find(|entry| entry.sha == sha)
            .map(|entry| entry.index)
            .ok_or_else(|| CoreError::InvalidRequest {
                detail: format!("the changes stashed when you left {branch} are gone"),
            })
    })
    .await?;
    let result = restore_stash(&app, &log, path.clone(), index, sha.clone(), true).await;
    if result.is_ok() {
        let forget = (path, branch, sha);
        blocking(move || {
            let (path, branch, sha) = forget;
            yforge_core::dismiss_switch_stash(&dir, Path::new(&path), &branch, &sha)
        })
        .await?;
    }
    log_outcome("switch_stash_restore", &result, |restore| {
        format!("{restore:?}")
    });
    result
}

#[tauri::command]
async fn switch_stash_dismiss(
    data: State<'_, DataDir>,
    path: String,
    branch: String,
    sha: String,
) -> Result<(), ErrorPayload> {
    log::debug!("switch_stash_dismiss path={path} branch={branch} sha={sha}");
    let dir = data_dir(&data);
    let result =
        blocking(move || yforge_core::dismiss_switch_stash(&dir, Path::new(&path), &branch, &sha))
            .await;
    log_outcome("switch_stash_dismiss", &result, |()| String::new());
    result
}

#[tauri::command]
async fn ssh_keys_list() -> Result<Vec<SshKey>, ErrorPayload> {
    log::debug!("ssh_keys_list");
    let result = blocking(|| {
        let home = std::env::var_os("HOME")
            .filter(|home| !home.is_empty())
            .ok_or_else(|| CoreError::InvalidRequest {
                detail: "HOME is not set, so ~/.ssh cannot be read".to_owned(),
            })?;
        yforge_core::list_ssh_keys(&Path::new(&home).join(".ssh"))
    })
    .await;
    log_outcome("ssh_keys_list", &result, |keys| {
        format!("keys={}", keys.len())
    });
    result
}

#[tauri::command]
async fn worktree_list(path: String) -> Result<Vec<WorktreeStatus>, ErrorPayload> {
    log::debug!("worktree_list path={path}");
    let result = blocking(move || yforge_core::list_worktrees(Path::new(&path))).await;
    log_outcome("worktree_list", &result, |worktrees| {
        format!("worktrees={}", worktrees.len())
    });
    result
}

#[tauri::command]
async fn worktree_suggest_path(path: String, branch: String) -> Result<String, ErrorPayload> {
    log::debug!("worktree_suggest_path path={path} branch={branch}");
    let result =
        blocking(move || yforge_core::suggest_worktree_path(Path::new(&path), &branch)).await;
    log_outcome("worktree_suggest_path", &result, |suggested| {
        format!("path={suggested}")
    });
    result
}

#[tauri::command]
async fn worktree_create<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    branch: String,
    create: bool,
    start: Option<String>,
    destination: String,
) -> Result<String, ErrorPayload> {
    log::debug!(
        "worktree_create path={path} branch={branch} create={create} start={start:?} destination={destination}"
    );
    let target = path.clone();
    let label = format!("Created a worktree for {branch} at {destination}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::CreateWorktree, true, true),
            move |_: &String| label,
            move || {
                yforge_core::create_worktree(
                    Path::new(&target),
                    &branch,
                    create,
                    start.as_deref(),
                    Path::new(&destination),
                )
            },
        )
        .await;
    log_outcome("worktree_create", &result, |location| {
        format!("path={location}")
    });
    result
}

#[tauri::command]
async fn worktree_remove<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    worktree: String,
    force: bool,
) -> Result<(), ErrorPayload> {
    log::debug!("worktree_remove path={path} worktree={worktree} force={force}");
    let target = path.clone();
    let label = format!("Removed the worktree at {worktree}");
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::RemoveWorktree, true, true),
            move |()| label,
            move || yforge_core::remove_worktree(Path::new(&target), &worktree, force),
        )
        .await;
    log_outcome("worktree_remove", &result, |()| String::new());
    result
}

#[tauri::command]
async fn worktree_integrate<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    worktree: String,
    target: String,
    cleanup: bool,
) -> Result<WorktreeIntegration, ErrorPayload> {
    log::debug!(
        "worktree_integrate path={path} worktree={worktree} target={target} cleanup={cleanup}"
    );
    let location = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::IntegrateWorktree, true, true),
            {
                let target = target.clone();
                move |outcome: &WorktreeIntegration| match outcome {
                    WorktreeIntegration::Integrated { cleaned_up, .. } => format!(
                        "Integrated the worktree into {target}{}",
                        if *cleaned_up { " and removed it" } else { "" }
                    ),
                    WorktreeIntegration::Conflicts { worktree } => {
                        format!("Rebase stopped on conflicts in {worktree}")
                    }
                }
            },
            move || {
                yforge_core::integrate_worktree(Path::new(&location), &worktree, &target, cleanup)
            },
        )
        .await;
    log_outcome("worktree_integrate", &result, |outcome| {
        format!("{outcome:?}")
    });
    result
}

pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(WatchState::default())
        .manage(Operations::default())
        .manage(ActivityLog::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            launch_path,
            repo_open,
            repo_graph,
            search_commits,
            diff_file,
            stage_files,
            unstage_files,
            stage_all,
            unstage_all,
            discard_files,
            stage_hunk,
            unstage_hunk,
            discard_hunk,
            stage_lines,
            unstage_lines,
            discard_lines,
            commit,
            edit_head_message,
            amend_info,
            commit_details,
            commit_file_diff,
            checkout,
            check_branch_name,
            create_branch,
            rename_branch,
            branch_delete_preview,
            delete_branch,
            delete_remote_branch,
            set_upstream,
            stash_push,
            stash_rename,
            switch_stashes,
            switch_stash_restore,
            switch_stash_dismiss,
            stash_apply,
            stash_pop,
            stash_drop,
            fetch,
            pull,
            pull_with_autostash,
            push,
            push_to,
            publish,
            push_plan,
            push_force,
            operation_cancel,
            auth_respond,
            operation_continue,
            operation_skip,
            operation_abort,
            mark_resolved,
            integration_preview,
            merge,
            rebase,
            rebase_plan,
            rebase_interactive,
            squash_commits,
            recompose_preview,
            recompose_apply,
            fast_forward,
            cherry_pick,
            revert,
            reset,
            create_tag,
            delete_tag,
            push_tag,
            delete_remote_tag,
            conflict_file,
            conflict_resolve,
            conflict_take_side,
            conflict_reset,
            repo_watch,
            ssh_keys_list,
            worktree_list,
            worktree_suggest_path,
            worktree_create,
            worktree_remove,
            worktree_integrate,
            clone_repo,
            init_repo,
            settings_load,
            settings_save,
            repo_settings_load,
            repo_settings_save,
            identity_read,
            identity_write,
            remotes_list,
            remote_add,
            remote_edit,
            remote_remove,
            recents_list,
            recent_add,
            recent_remove,
            recent_statuses,
            session_load,
            session_save,
            open_path,
            activity_list,
            activity_history,
            activity_clear,
            crash_report,
            crash_list,
            crash_export,
            crash_clear,
            usage_list,
            usage_export,
            usage_clear,
            undo_last
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let default_filter = if cfg!(debug_assertions) {
        "warn,yforge_lib=debug"
    } else {
        "warn"
    };
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default_filter))
        .init();
    register(tauri::Builder::default().plugin(tauri_plugin_dialog::init()))
        .setup(|app| {
            let dir = match std::env::var_os(DATA_DIR_ENV).filter(|value| !value.is_empty()) {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            if let Some(moved) = yforge_core::start_storage(&dir)? {
                log::warn!(
                    "diagnostics database was unreadable and was moved to {}",
                    moved.display()
                );
            }
            crash::seed_repositories(&dir);
            install_panic_hook(dir.clone());
            app.manage(DataDir(dir));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the YForge application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cwd() -> std::io::Result<PathBuf> {
        Ok(PathBuf::from("/work"))
    }

    #[test]
    fn launch_path_prefers_env_then_first_argument_then_current_directory() {
        let chosen = choose_launch_path(Some("/env".into()), Some("/arg".into()), cwd()).unwrap();
        assert_eq!(chosen, PathBuf::from("/env"));
        let chosen = choose_launch_path(None, Some("/arg".into()), cwd()).unwrap();
        assert_eq!(chosen, PathBuf::from("/arg"));
        let chosen = choose_launch_path(Some("".into()), None, cwd()).unwrap();
        assert_eq!(chosen, PathBuf::from("/work"));
    }

    #[test]
    fn launch_path_reports_an_unreadable_current_directory() {
        let error = choose_launch_path(None, None, Err(std::io::Error::other("gone"))).unwrap_err();
        assert_eq!(error.kind, yforge_core::ErrorKind::Internal);
    }
}
