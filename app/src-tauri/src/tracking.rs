use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Runtime};
use yforge_core::{
    collect_activity, ActivityEntry, CommandRecord, CoreError, ErrorKind, ErrorPayload, Planned,
    UndoAction, UndoStatus,
};

pub const ACTIVITY_EVENT: &str = "activity-recorded";
const LOG_LIMIT: usize = 300;

#[derive(Debug, Clone)]
pub struct Track {
    pub repo: String,
    pub operation: &'static str,
    pub local: bool,
    pub toast: bool,
}

pub struct Draft {
    meta: Track,
    summary: String,
    started_at: i64,
    duration_ms: u32,
    error: Option<String>,
    commands: Vec<CommandRecord>,
    undo: Planned,
}

struct Stored {
    entry: ActivityEntry,
    action: Option<UndoAction>,
}

#[derive(Default)]
struct Inner {
    entries: Mutex<Vec<Stored>>,
    next: AtomicU32,
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
    let no_undo = || Planned::Unavailable(format!("{} has no safe undo", meta.operation));
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
            format!("{} failed", meta.operation),
            Some(error.to_string()),
            no_undo(),
        ),
    };
    let draft = Draft {
        meta: meta.clone(),
        summary,
        started_at,
        duration_ms,
        error,
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
                meta.operation
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

    pub fn clear(&self, repo: Option<&str>) {
        self.lock()
            .retain(|stored| repo.is_some_and(|repo| stored.entry.repo != repo));
    }

    pub fn record<R: Runtime>(&self, app: &AppHandle<R>, draft: Draft) -> ActivityEntry {
        let (undo, action) = match draft.undo {
            Planned::Available(plan) => (
                UndoStatus::Available { scope: plan.scope },
                Some(plan.action),
            ),
            Planned::Unavailable(reason) => (UndoStatus::Unavailable { reason }, None),
        };
        let entry = ActivityEntry {
            id: self.0.next.fetch_add(1, Ordering::SeqCst) + 1,
            repo: draft.meta.repo,
            operation: draft.meta.operation.to_owned(),
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
