use std::path::Path;

use tauri::{AppHandle, Emitter, Runtime, State};
use yforge_core::{
    CancelToken, ErrorPayload, FlowFinished, FlowKind, GitFlowConfig, HookList, HookMode,
    HookOutcome, HookOutput, HookScript, OperationKind, OperationOutcome, Planned, HOOK_LIMIT,
};

use super::{blocking, data_dir, log_outcome, recorder, track, ActivityLog, DataDir, Operations};

const HOOK_OUTPUT_EVENT: &str = "hook-output";

#[tauri::command]
pub async fn hooks_list(data: State<'_, DataDir>, path: String) -> Result<HookList, ErrorPayload> {
    log::debug!("hooks_list path={path}");
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::hooks_list(&dir, Path::new(&path))).await;
    log_outcome("hooks_list", &result, |list| {
        format!("hooks={}", list.hooks.len())
    });
    result
}

#[tauri::command]
pub async fn hook_read(
    data: State<'_, DataDir>,
    path: String,
    name: String,
) -> Result<HookScript, ErrorPayload> {
    log::debug!("hook_read path={path} name={name}");
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::hook_read(&dir, Path::new(&path), &name)).await;
    log_outcome("hook_read", &result, |script| {
        format!("bytes={}", script.content.len())
    });
    result
}

#[tauri::command]
pub async fn hook_approve(
    data: State<'_, DataDir>,
    path: String,
    name: String,
) -> Result<(), ErrorPayload> {
    log::debug!("hook_approve path={path} name={name}");
    let dir = data_dir(&data);
    let result = blocking(move || yforge_core::hook_approve(&dir, Path::new(&path), &name)).await;
    log_outcome("hook_approve", &result, |()| String::new());
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn hook_run<R: Runtime>(
    app: AppHandle<R>,
    data: State<'_, DataDir>,
    operations: State<'_, Operations>,
    path: String,
    id: String,
    name: String,
    mode: HookMode,
    message: String,
) -> Result<HookOutcome, ErrorPayload> {
    log::debug!("hook_run path={path} id={id} name={name} mode={mode:?}");
    let dir = data_dir(&data);
    let token = operations.running.register(&id, CancelToken::new())?;
    let announced = id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        yforge_core::run_hook(
            &dir,
            Path::new(&path),
            &name,
            mode,
            &message,
            HOOK_LIMIT,
            &token,
            &mut |stream, text| {
                let payload = HookOutput {
                    id: announced.clone(),
                    stream,
                    text: text.to_owned(),
                };
                if let Err(error) = app.emit(HOOK_OUTPUT_EVENT, payload) {
                    log::warn!("could not emit {HOOK_OUTPUT_EVENT}: {error}");
                }
            },
        )
    })
    .await;
    operations.running.finish(&id);
    let result = joined
        .map_err(|error| ErrorPayload::internal(error.to_string()))?
        .map_err(ErrorPayload::from);
    log_outcome("hook_run", &result, |outcome| format!("{outcome:?}"));
    result
}

#[tauri::command]
pub async fn git_flow_config(path: String) -> Result<Option<GitFlowConfig>, ErrorPayload> {
    log::debug!("git_flow_config path={path}");
    let result = blocking(move || yforge_core::git_flow_config(Path::new(&path))).await;
    log_outcome("git_flow_config", &result, |config| {
        format!("initialized={}", config.is_some())
    });
    result
}

#[tauri::command]
pub async fn git_flow_init<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    config: GitFlowConfig,
) -> Result<(), ErrorPayload> {
    log::debug!("git_flow_init path={path} config={config:?}");
    let target = path.clone();
    let result = recorder(&app, &log)
        .recorded(
            track(&path, OperationKind::GitFlowInit, true, true),
            |()| "Initialized Git Flow".to_owned(),
            move || yforge_core::git_flow_init(Path::new(&target), &config),
        )
        .await;
    log_outcome("git_flow_init", &result, |()| String::new());
    result
}

#[tauri::command]
pub async fn git_flow_start<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
    kind: FlowKind,
    name: String,
) -> Result<String, ErrorPayload> {
    log::debug!("git_flow_start path={path} kind={kind:?} name={name}");
    let target = path.clone();
    let planned = path.clone();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::GitFlowStart, true, true),
            |branch: &String| format!("Started {branch}"),
            {
                let path = path.clone();
                move || yforge_core::head_ref(Path::new(&path))
            },
            move || yforge_core::flow_start(Path::new(&target), kind, &name),
            move |before, branch| {
                let tip = yforge_core::branch_snapshot(Path::new(&planned), branch)?
                    .map(|snapshot| snapshot.sha)
                    .unwrap_or_default();
                Ok(yforge_core::plan_branch_create(branch, &tip, &before, true))
            },
        )
        .await;
    log_outcome("git_flow_start", &result, |branch| {
        format!("branch={branch}")
    });
    result
}

#[tauri::command]
pub async fn git_flow_finish<R: Runtime>(
    app: AppHandle<R>,
    log: State<'_, ActivityLog>,
    path: String,
) -> Result<FlowFinished, ErrorPayload> {
    log::debug!("git_flow_finish path={path}");
    let target = path.clone();
    let planned = path.clone();
    let result = recorder(&app, &log)
        .tracked(
            track(&path, OperationKind::GitFlowFinish, true, true),
            |finished: &FlowFinished| {
                if finished.outcome == OperationOutcome::Conflicts {
                    format!("Finishing {} stopped on conflicts", finished.branch)
                } else {
                    format!("Finished {}", finished.branch)
                }
            },
            {
                let path = path.clone();
                move || yforge_core::flow_snapshot(Path::new(&path))
            },
            move || yforge_core::flow_finish(Path::new(&target)),
            move |before, finished| -> Result<Planned, yforge_core::CoreError> {
                yforge_core::plan_flow_finish(Path::new(&planned), &before, finished)
            },
        )
        .await;
    log_outcome("git_flow_finish", &result, |finished| {
        format!("{:?}", finished.outcome)
    });
    result
}
