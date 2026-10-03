use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use yforge_core::{
    collect_activity, ActivityEntry, CommandRecord, CoreError, ErrorKind, ErrorPayload,
    OperationKind, Planned, ProviderKind, RedoChange, UndoAction, UndoPlan, UndoStatus, UsageEvent,
};

use crate::DataDir;

pub const ACTIVITY_EVENT: &str = "activity-recorded";
pub const REDO_EVENT: &str = "redo-changed";
const LOG_LIMIT: usize = 300;
const PRIOR_SESSION_UNDO: &str = "Undo is only available in the session that ran the operation";

#[derive(Debug, Clone)]
pub struct Track {
    pub repo: String,
    pub operation: OperationKind,
    pub local: bool,
    pub toast: bool,
}

pub struct Draft {
    meta: Track,
    summary: String,
    started_at: i64,
    duration_ms: u32,
    error: Option<String>,
    error_kind: Option<ErrorKind>,
    commands: Vec<CommandRecord>,
    undo: Planned,
    ai: Option<(ProviderKind, Option<String>)>,
}

pub struct AiRun {
    pub repo: String,
    pub operation: OperationKind,
    pub provider: ProviderKind,
    pub provider_name: String,
    pub model: Option<String>,
    pub started_at: i64,
    pub duration_ms: u32,
    pub error_kind: Option<ErrorKind>,
}

impl Draft {
    pub fn ai(run: AiRun) -> Self {
        let label = run.operation.label();
        let failed = run.error_kind;
        Self {
            summary: match (&failed, &run.model) {
                (Some(_), _) => format!("{label} failed"),
                (None, Some(model)) => format!("{} · {model}", run.provider_name),
                (None, None) => run.provider_name.clone(),
            },
            error: failed.map(error_label),
            error_kind: failed,
            commands: Vec::new(),
            undo: Planned::Unavailable(format!("{label} has no safe undo")),
            ai: Some((run.provider, run.model)),
            started_at: run.started_at,
            duration_ms: run.duration_ms,
            meta: Track {
                repo: run.repo,
                operation: run.operation,
                local: false,
                toast: false,
            },
        }
    }
}

fn error_label(kind: ErrorKind) -> String {
    let mut label = String::new();
    for c in format!("{kind:?}").chars() {
        if c.is_ascii_uppercase() && !label.is_empty() {
            label.push('_');
        }
        label.push(c.to_ascii_lowercase());
    }
    label
}

struct RedoSlot {
    sequence: u64,
    redo: UndoPlan,
    undo: UndoPlan,
}

struct Stored {
    entry: ActivityEntry,
    action: Option<UndoAction>,
    redo: Option<RedoSlot>,
}

struct Inner {
    entries: Mutex<Vec<Stored>>,
    unsaved: AtomicU32,
    redo_sequence: AtomicU64,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            entries: Mutex::default(),
            unsaved: AtomicU32::new(u32::MAX),
            redo_sequence: AtomicU64::new(0),
        }
    }
}

pub struct RedoTarget {
    pub id: u32,
    pub operation: String,
    pub redo: UndoPlan,
    pub undo: UndoPlan,
}

#[derive(Clone, Default)]
pub struct ActivityLog(Arc<Inner>);

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_secs()).ok())
        .unwrap_or_default()
}

pub fn execute<T, S>(
    meta: &Track,
    summarize: impl FnOnce(&T) -> String,
    prepare: impl FnOnce() -> Result<S, CoreError>,
    run: impl FnOnce() -> Result<T, CoreError>,
    plan: impl FnOnce(S, &T) -> Result<Planned, CoreError>,
) -> (Result<T, CoreError>, Draft) {
    let started_at = unix_now();
    let clock = Instant::now();
    let prepared = prepare();
    let (result, commands) = match prepared {
        Ok(state) => {
            let (result, commands) = collect_activity(run);
            (result.map(|value| (state, value)), commands)
        }
        Err(error) => (Err(error), Vec::new()),
    };
    let duration_ms = u32::try_from(clock.elapsed().as_millis()).unwrap_or(u32::MAX);
    let label = meta.operation.label();
    let no_undo = || Planned::Unavailable(format!("{label} has no safe undo"));
    let (result, summary, error, undo) = match result {
        Ok((state, value)) => {
            let summary = summarize(&value);
            let undo = plan(state, &value).unwrap_or_else(|error| {
                Planned::Unavailable(format!("Undo could not be prepared: {error}"))
            });
            (Ok(value), summary, None, undo)
        }
        Err(error) => (
            Err(error.clone()),
            format!("{label} failed"),
            Some(error.to_string()),
            no_undo(),
        ),
    };
    let error_kind = result.as_ref().err().map(CoreError::kind);
    let draft = Draft {
        meta: meta.clone(),
        summary,
        started_at,
        duration_ms,
        error,
        error_kind,
        commands,
        undo,
        ai: None,
    };
    (result, draft)
}

pub fn plain<T>(
    meta: &Track,
    summarize: impl FnOnce(&T) -> String,
    run: impl FnOnce() -> Result<T, CoreError>,
) -> (Result<T, CoreError>, Draft) {
    execute(
        meta,
        summarize,
        || Ok(()),
        run,
        |(), _| {
            Ok(Planned::Unavailable(format!(
                "{} has no safe undo",
                meta.operation.label()
            )))
        },
    )
}

impl ActivityLog {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Stored>> {
        self.0
            .entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn list(&self) -> Vec<ActivityEntry> {
        self.lock()
            .iter()
            .map(|stored| stored.entry.clone())
            .collect()
    }

    pub fn history(
        &self,
        dir: &Path,
        repo: &str,
        before: Option<u32>,
        limit: u32,
    ) -> Result<Vec<ActivityEntry>, CoreError> {
        let mut entries = yforge_core::activity_history(dir, repo, before, limit)?;
        let live: HashSet<u32> = self
            .lock()
            .iter()
            .filter(|stored| stored.action.is_some())
            .map(|stored| stored.entry.id)
            .collect();
        for entry in &mut entries {
            if matches!(entry.undo, UndoStatus::Available { .. }) && !live.contains(&entry.id) {
                entry.undo = UndoStatus::Unavailable {
                    reason: PRIOR_SESSION_UNDO.to_owned(),
                };
            }
        }
        Ok(entries)
    }

    pub fn clear<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        dir: &Path,
        repo: Option<&str>,
    ) -> Result<(), CoreError> {
        yforge_core::clear_activity(dir, repo)?;
        let mut forgotten: Vec<String> = {
            let mut entries = self.lock();
            let forgotten = entries
                .iter()
                .filter(|stored| {
                    stored.redo.is_some() && repo.is_none_or(|repo| stored.entry.repo == repo)
                })
                .map(|stored| stored.entry.repo.clone())
                .collect();
            entries.retain(|stored| repo.is_some_and(|repo| stored.entry.repo != repo));
            forgotten
        };
        forgotten.sort();
        forgotten.dedup();
        for repository in forgotten {
            self.announce_redo(app, &repository);
        }
        Ok(())
    }

    pub fn record<R: Runtime>(&self, app: &AppHandle<R>, draft: Draft) -> ActivityEntry {
        let dir = app.state::<DataDir>().0.clone();
        let (undo, action) = match draft.undo {
            Planned::Available(plan) => (
                UndoStatus::Available { scope: plan.scope },
                Some(plan.action),
            ),
            Planned::Unavailable(reason) => (UndoStatus::Unavailable { reason }, None),
        };
        crate::note_repository(&draft.meta.repo);
        let invalidates_redo = draft.meta.local
            && draft.error.is_none()
            && draft.meta.operation != OperationKind::Redo;
        let mut entry = ActivityEntry {
            id: 0,
            repo: draft.meta.repo,
            operation: draft.meta.operation.label().to_owned(),
            summary: draft.summary,
            started_at: draft.started_at,
            duration_ms: draft.duration_ms,
            ok: draft.error.is_none(),
            local: draft.meta.local,
            toast: draft.meta.toast,
            error: draft.error,
            commands: draft.commands,
            undo,
        };
        entry.id = match yforge_core::append_activity(&dir, &entry) {
            Ok(id) => id,
            Err(error) => {
                log::error!("could not persist the activity entry: {error}");
                self.0.unsaved.fetch_sub(1, Ordering::SeqCst)
            }
        };
        let usage = UsageEvent {
            kind: draft.meta.operation,
            ok: entry.ok,
            error_kind: draft.error_kind,
            duration_ms: entry.duration_ms,
            count: u32::try_from(entry.commands.len()).unwrap_or(u32::MAX),
            correlation_id: entry.id,
            provider: draft.ai.as_ref().map(|(provider, _)| *provider),
            model: draft.ai.and_then(|(_, model)| model),
        };
        if let Err(error) = yforge_core::record_usage(&dir, env!("CARGO_PKG_VERSION"), &usage) {
            log::error!("could not record the usage event: {error}");
        }
        let cleared = {
            let mut entries = self.lock();
            let cleared = invalidates_redo
                && entries
                    .iter_mut()
                    .filter(|stored| stored.entry.repo == entry.repo)
                    .filter_map(|stored| stored.redo.take())
                    .count()
                    > 0;
            entries.push(Stored {
                entry: entry.clone(),
                action,
                redo: None,
            });
            let excess = entries.len().saturating_sub(LOG_LIMIT);
            entries.drain(..excess);
            cleared
        };
        announce(app, &entry);
        if cleared {
            self.announce_redo(app, &entry.repo);
        }
        entry
    }

    fn redo_scope(&self, repo: &str) -> Option<String> {
        self.lock()
            .iter()
            .filter(|stored| stored.entry.repo == repo)
            .filter_map(|stored| stored.redo.as_ref())
            .max_by_key(|slot| slot.sequence)
            .map(|slot| slot.redo.scope.clone())
    }

    fn announce_redo<R: Runtime>(&self, app: &AppHandle<R>, repo: &str) {
        let change = RedoChange {
            repo: repo.to_owned(),
            scope: self.redo_scope(repo),
        };
        if let Err(error) = app.emit(REDO_EVENT, change) {
            log::warn!("could not emit {REDO_EVENT}: {error}");
        }
    }

    pub fn store_redo<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: u32,
        (redo, undo): (UndoPlan, UndoPlan),
    ) {
        let sequence = self.0.redo_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let repo = {
            let mut entries = self.lock();
            entries
                .iter_mut()
                .find(|stored| stored.entry.id == id)
                .map(|stored| {
                    stored.redo = Some(RedoSlot {
                        sequence,
                        redo,
                        undo,
                    });
                    stored.entry.repo.clone()
                })
        };
        if let Some(repo) = repo {
            self.announce_redo(app, &repo);
        }
    }

    pub fn redo_target(&self, repo: &str) -> Result<RedoTarget, ErrorPayload> {
        let entries = self.lock();
        entries
            .iter()
            .filter(|stored| stored.entry.repo == repo)
            .filter_map(|stored| stored.redo.as_ref().map(|slot| (stored, slot)))
            .max_by_key(|(_, slot)| slot.sequence)
            .map(|(stored, slot)| RedoTarget {
                id: stored.entry.id,
                operation: stored.entry.operation.clone(),
                redo: slot.redo.clone(),
                undo: slot.undo.clone(),
            })
            .ok_or_else(|| ErrorPayload {
                kind: ErrorKind::InvalidRequest,
                message: "Invalid request: nothing to redo".to_owned(),
                output: None,
            })
    }

    pub fn consume_redo<R: Runtime>(&self, app: &AppHandle<R>, id: u32) {
        let repo = {
            let mut entries = self.lock();
            entries
                .iter_mut()
                .find(|stored| stored.entry.id == id)
                .map(|stored| {
                    stored.redo = None;
                    stored.entry.repo.clone()
                })
        };
        if let Some(repo) = repo {
            self.announce_redo(app, &repo);
        }
    }

    pub fn undo_target(&self, repo: &str, id: u32) -> Result<(String, UndoPlan), ErrorPayload> {
        let invalid = |message: &str| ErrorPayload {
            kind: ErrorKind::InvalidRequest,
            message: format!("Invalid request: {message}"),
            output: None,
        };
        let entries = self.lock();
        let latest = entries
            .iter()
            .rev()
            .find(|stored| {
                stored.entry.repo == repo
                    && stored.entry.local
                    && stored.entry.ok
                    && stored.entry.undo != UndoStatus::Undone
            })
            .map(|stored| stored.entry.id);
        if latest != Some(id) {
            return Err(invalid("only the last local operation can be undone"));
        }
        let stored = entries
            .iter()
            .find(|stored| stored.entry.id == id)
            .ok_or_else(|| invalid("that operation is no longer in the activity log"))?;
        let (action, UndoStatus::Available { scope }) =
            (stored.action.clone(), stored.entry.undo.clone())
        else {
            return Err(invalid("that operation has no safe undo"));
        };
        let action = action.ok_or_else(|| invalid("that operation has no safe undo"))?;
        Ok((stored.entry.operation.clone(), UndoPlan { action, scope }))
    }

    pub fn mark_undone<R: Runtime>(&self, app: &AppHandle<R>, id: u32) {
        let dir = app.state::<DataDir>().0.clone();
        if let Err(error) = yforge_core::mark_activity_undone(&dir, id) {
            log::error!("could not persist the undone status: {error}");
        }
        let updated = {
            let mut entries = self.lock();
            entries
                .iter_mut()
                .find(|stored| stored.entry.id == id)
                .map(|stored| {
                    stored.entry.undo = UndoStatus::Undone;
                    stored.action = None;
                    stored.entry.clone()
                })
        };
        if let Some(entry) = updated {
            announce(app, &entry);
        }
    }
}

fn announce<R: Runtime>(app: &AppHandle<R>, entry: &ActivityEntry) {
    log::debug!(
        "activity-recorded id={} repo={} operation={} ok={} commands={} undo={:?}",
        entry.id,
        entry.repo,
        entry.operation,
        entry.ok,
        entry.commands.len(),
        entry.undo
    );
    if let Err(error) = app.emit(ACTIVITY_EVENT, entry.clone()) {
        log::warn!("could not emit {ACTIVITY_EVENT}: {error}");
    }
}
