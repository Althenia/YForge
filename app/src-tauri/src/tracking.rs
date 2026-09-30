use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use yforge_core::{
    collect_activity, ActivityEntry, CommandRecord, CoreError, ErrorKind, ErrorPayload,
    OperationKind, Planned, UndoAction, UndoStatus, UsageEvent,
};

use crate::DataDir;

pub const ACTIVITY_EVENT: &str = "activity-recorded";
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
}

struct Stored {
    entry: ActivityEntry,
    action: Option<UndoAction>,
}

struct Inner {
    entries: Mutex<Vec<Stored>>,
    unsaved: AtomicU32,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            entries: Mutex::default(),
            unsaved: AtomicU32::new(u32::MAX),
        }
    }
}

#[derive(Clone, Default)]
pub struct ActivityLog(Arc<Inner>);

fn unix_now() -> i64 {
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

    pub fn clear(&self, dir: &Path, repo: Option<&str>) -> Result<(), CoreError> {
        yforge_core::clear_activity(dir, repo)?;
        self.lock()
            .retain(|stored| repo.is_some_and(|repo| stored.entry.repo != repo));
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
        };
        if let Err(error) = yforge_core::record_usage(&dir, env!("CARGO_PKG_VERSION"), &usage) {
            log::error!("could not record the usage event: {error}");
        }
        {
            let mut entries = self.lock();
            entries.push(Stored {
                entry: entry.clone(),
                action,
            });
            let excess = entries.len().saturating_sub(LOG_LIMIT);
            entries.drain(..excess);
        }
        announce(app, &entry);
        entry
    }

    pub fn undo_target(&self, repo: &str, id: u32) -> Result<(String, UndoAction), ErrorPayload> {
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
        let action = stored
            .action
            .clone()
            .ok_or_else(|| invalid("that operation has no safe undo"))?;
        Ok((stored.entry.operation.clone(), action))
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
