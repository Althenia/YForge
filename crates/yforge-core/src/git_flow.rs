use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::branch::{self, ref_exists};
use crate::error::CoreError;
use crate::git;
use crate::integrate;
use crate::model::{MergeMode, OperationOutcome};
use crate::operation::require_no_operation;
use crate::repo;
use crate::tag;
use crate::undo::{head_ref, tracked_changes, HeadRef, Planned, UndoAction, UndoPlan};

const PRODUCTION: &str = "gitflow.branch.master";
const DEVELOPMENT: &str = "gitflow.branch.develop";
const FEATURE: &str = "gitflow.prefix.feature";
const RELEASE: &str = "gitflow.prefix.release";
const HOTFIX: &str = "gitflow.prefix.hotfix";
const BUGFIX: &str = "gitflow.prefix.bugfix";
const SUPPORT: &str = "gitflow.prefix.support";
const VERSION_TAG: &str = "gitflow.prefix.versiontag";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GitFlowConfig {
    pub production: String,
    pub development: String,
    pub feature: String,
    pub release: String,
    pub hotfix: String,
    pub version_tag: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FlowKind {
    Feature,
    Release,
    Hotfix,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct FlowFinished {
    pub outcome: OperationOutcome,
    pub branch: String,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlowSnapshot {
    head: Option<HeadRef>,
    branch: Option<(String, String)>,
    production: Option<(String, String)>,
    development: Option<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MovedBranch {
    name: String,
    from: String,
    to: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlowRestore {
    head_before: HeadRef,
    head_after: String,
    branch: String,
    branch_sha: String,
    moved: Vec<MovedBranch>,
    tag: Option<(String, String)>,
}

fn read(root: &Path, key: &str) -> Result<Option<String>, CoreError> {
    let completed = git::run_unchecked(root, &["config", "--get", key], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim_end_matches('\n').to_owned()))
}

fn write(root: &Path, key: &str, value: &str) -> Result<(), CoreError> {
    git::run(root, &["config", "--local", key, value]).map(drop)
}

fn config_of(root: &Path) -> Result<Option<GitFlowConfig>, CoreError> {
    let (Some(production), Some(development)) = (read(root, PRODUCTION)?, read(root, DEVELOPMENT)?)
    else {
        return Ok(None);
    };
    let prefix = |key: &str, default: &str| -> Result<String, CoreError> {
        Ok(read(root, key)?.unwrap_or_else(|| default.to_owned()))
    };
    Ok(Some(GitFlowConfig {
        production,
        development,
        feature: prefix(FEATURE, "feature/")?,
        release: prefix(RELEASE, "release/")?,
        hotfix: prefix(HOTFIX, "hotfix/")?,
        version_tag: prefix(VERSION_TAG, "")?,
    }))
}

fn require_config(root: &Path) -> Result<GitFlowConfig, CoreError> {
    config_of(root)?
        .ok_or_else(|| CoreError::invalid_request("initialize Git Flow in this repository first"))
}

pub fn git_flow_config(path: &Path) -> Result<Option<GitFlowConfig>, CoreError> {
    config_of(&repo::open(path)?)
}

fn require_prefix(root: &Path, label: &str, prefix: &str) -> Result<(), CoreError> {
    if prefix.is_empty() {
        return Err(CoreError::invalid_request(format!(
            "enter the {label} prefix"
        )));
    }
    branch::validated_name(root, &format!("{prefix}x"))
        .map(drop)
        .map_err(|_| {
            CoreError::invalid_request(format!("{prefix:?} is not a valid {label} prefix"))
        })
}

pub fn git_flow_init(path: &Path, config: &GitFlowConfig) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    branch::validated_name(&root, &config.production)?;
    branch::validated_name(&root, &config.development)?;
    if config.production == config.development {
        return Err(CoreError::invalid_request(
            "the production and development branches must differ",
        ));
    }
    let prefixes = [
        ("feature", &config.feature),
        ("release", &config.release),
        ("hotfix", &config.hotfix),
    ];
    for (label, prefix) in prefixes {
        require_prefix(&root, label, prefix)?;
    }
    if prefixes
        .iter()
        .enumerate()
        .any(|(at, (_, prefix))| prefixes[..at].iter().any(|(_, other)| other == prefix))
    {
        return Err(CoreError::invalid_request(
            "the feature, release, and hotfix prefixes must differ",
        ));
    }
    if !config.version_tag.is_empty() {
        let name = format!("refs/tags/{}x", config.version_tag);
        if !git::run_unchecked(&root, &["check-ref-format", &name], None)?.succeeded() {
            return Err(CoreError::invalid_request(format!(
                "{:?} is not a valid version tag prefix",
                config.version_tag
            )));
        }
    }
    branch::require_local_branch(&root, &config.production).map_err(|_| {
        CoreError::invalid_request(format!(
            "there is no production branch {}; create it first",
            config.production
        ))
    })?;
    if !ref_exists(&root, &format!("refs/heads/{}", config.development))? {
        git::run(
            &root,
            &[
                "branch",
                &config.development,
                &format!("refs/heads/{}", config.production),
            ],
        )?;
    }
    write(&root, PRODUCTION, &config.production)?;
    write(&root, DEVELOPMENT, &config.development)?;
    write(&root, FEATURE, &config.feature)?;
    write(&root, RELEASE, &config.release)?;
    write(&root, HOTFIX, &config.hotfix)?;
    write(&root, VERSION_TAG, &config.version_tag)?;
    for (key, default) in [(BUGFIX, "bugfix/"), (SUPPORT, "support/")] {
        if read(&root, key)?.is_none() {
            write(&root, key, default)?;
        }
    }
    Ok(())
}

fn prefix_of(config: &GitFlowConfig, kind: FlowKind) -> &str {
    match kind {
        FlowKind::Feature => &config.feature,
        FlowKind::Release => &config.release,
        FlowKind::Hotfix => &config.hotfix,
    }
}

fn kind_label(kind: FlowKind) -> &'static str {
    match kind {
        FlowKind::Feature => "feature",
        FlowKind::Release => "release",
        FlowKind::Hotfix => "hotfix",
    }
}

pub fn flow_start(path: &Path, kind: FlowKind, name: &str) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    let config = require_config(&root)?;
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::invalid_request(format!(
            "enter a {} name",
            kind_label(kind)
        )));
    }
    let base = match kind {
        FlowKind::Hotfix => &config.production,
        FlowKind::Feature | FlowKind::Release => &config.development,
    };
    branch::require_local_branch(&root, base)?;
    let created = format!("{}{name}", prefix_of(&config, kind));
    branch::create_branch(&root, &created, Some(&format!("refs/heads/{base}")), true)?;
    Ok(created)
}

fn classify(config: &GitFlowConfig, branch: &str) -> Option<(FlowKind, String)> {
    [FlowKind::Feature, FlowKind::Release, FlowKind::Hotfix]
        .into_iter()
        .find_map(|kind| {
            branch
                .strip_prefix(prefix_of(config, kind))
                .filter(|name| !name.is_empty())
                .map(|name| (kind, name.to_owned()))
        })
}

fn switch(root: &Path, branch: &str) -> Result<(), CoreError> {
    git::run(root, &["switch", "--quiet", branch])
        .map(drop)
        .map_err(branch::classify_local_changes)
}

fn merge_into(root: &Path, target: &str, source: &str) -> Result<OperationOutcome, CoreError> {
    switch(root, target)?;
    integrate::merge(root, source, MergeMode::MergeCommit)
}

fn finished(outcome: OperationOutcome, branch: String, tag: Option<String>) -> FlowFinished {
    FlowFinished {
        outcome,
        branch,
        tag,
    }
}

pub fn flow_finish(path: &Path) -> Result<FlowFinished, CoreError> {
    let root = repo::open(path)?;
    require_no_operation(&root)?;
    let config = require_config(&root)?;
    let branch = branch::current_branch(&root)?.ok_or_else(|| {
        CoreError::invalid_request("check out a feature, release, or hotfix branch to finish it")
    })?;
    let (kind, name) = classify(&config, &branch).ok_or_else(|| {
        CoreError::invalid_request(format!(
            "{branch} is not a feature, release, or hotfix branch"
        ))
    })?;
    if tracked_changes(&root)? {
        return Err(CoreError::LocalChanges {
            detail: "Finishing needs a clean working tree; commit or stash your changes first."
                .to_owned(),
        });
    }
    branch::require_local_branch(&root, &config.development)?;
    if kind == FlowKind::Feature {
        let outcome = merge_into(&root, &config.development, &branch)?;
        if outcome == OperationOutcome::Conflicts {
            return Ok(finished(outcome, branch, None));
        }
        branch::delete_branch(&root, &branch, true)?;
        return Ok(finished(outcome, branch, None));
    }
    branch::require_local_branch(&root, &config.production)?;
    let tag_name = format!("{}{name}", config.version_tag);
    if ref_exists(&root, &format!("refs/tags/{tag_name}"))? {
        return Err(CoreError::invalid_request(format!(
            "a tag named {tag_name} already exists"
        )));
    }
    if !git::run_unchecked(
        &root,
        &["check-ref-format", &format!("refs/tags/{tag_name}")],
        None,
    )?
    .succeeded()
    {
        return Err(CoreError::invalid_request(format!(
            "{tag_name:?} is not a valid tag name"
        )));
    }
    let outcome = merge_into(&root, &config.production, &branch)?;
    if outcome == OperationOutcome::Conflicts {
        return Ok(finished(outcome, branch, None));
    }
    let message = format!("{} {name}", capitalised(kind_label(kind)));
    tag::create_tag(&root, &tag_name, None, Some(&message))?;
    let outcome = merge_into(&root, &config.development, &branch)?;
    if outcome == OperationOutcome::Conflicts {
        return Ok(finished(outcome, branch, Some(tag_name)));
    }
    branch::delete_branch(&root, &branch, true)?;
    Ok(finished(outcome, branch, Some(tag_name)))
}

fn capitalised(word: &str) -> String {
    let mut letters = word.chars();
    letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default()
}

fn tip(root: &Path, branch: &str) -> Result<Option<(String, String)>, CoreError> {
    let completed = git::run_unchecked(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
        None,
    )?;
    Ok(completed
        .succeeded()
        .then(|| (branch.to_owned(), completed.stdout.trim().to_owned())))
}

pub fn flow_snapshot(path: &Path) -> Result<FlowSnapshot, CoreError> {
    let root = repo::open(path)?;
    let config = require_config(&root)?;
    let current = branch::current_branch(&root)?;
    Ok(FlowSnapshot {
        head: head_ref(&root)?,
        branch: match &current {
            Some(name) => tip(&root, name)?,
            None => None,
        },
        production: tip(&root, &config.production)?,
        development: tip(&root, &config.development)?,
    })
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

pub fn plan_flow_finish(
    path: &Path,
    before: &FlowSnapshot,
    result: &FlowFinished,
) -> Result<Planned, CoreError> {
    if result.outcome == OperationOutcome::Conflicts {
        return Ok(Planned::Unavailable(
            "The finish stopped on conflicts; finish or abort the operation instead".to_owned(),
        ));
    }
    let root = repo::open(path)?;
    let config = require_config(&root)?;
    let (Some(head), Some((branch, branch_sha))) = (before.head.clone(), before.branch.clone())
    else {
        return Ok(Planned::Unavailable(
            "The branch was not found before finishing".to_owned(),
        ));
    };
    let mut moved = Vec::new();
    for (earlier, name) in [
        (&before.production, &config.production),
        (&before.development, &config.development),
    ] {
        let (Some((_, from)), Some((_, to))) = (earlier, tip(&root, name)?) else {
            continue;
        };
        if from != &to {
            moved.push(MovedBranch {
                name: name.clone(),
                from: to,
                to: from.clone(),
            });
        }
    }
    let tag = match &result.tag {
        Some(name) => {
            let sha = git::run(&root, &["rev-parse", &format!("refs/tags/{name}")])?;
            Some((name.clone(), sha.trim().to_owned()))
        }
        None => None,
    };
    let names: Vec<&str> = moved.iter().map(|entry| entry.name.as_str()).collect();
    let scope = format!(
        "Undo finish {branch}: recreates it at {}, moves {} back{}, and switches back to it; needs a clean working tree",
        short(&branch_sha),
        names.join(" and "),
        tag.as_ref()
            .map(|(name, _)| format!(", removes tag {name}"))
            .unwrap_or_default()
    );
    Ok(Planned::Available(UndoPlan {
        action: UndoAction::GitFlowFinish(FlowRestore {
            head_before: head,
            head_after: config.development,
            branch,
            branch_sha,
            moved,
            tag,
        }),
        scope,
    }))
}

fn refuse(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_request(format!("{}. Nothing was changed", detail.into()))
}

pub(crate) fn undo_finish(root: &Path, restore: &FlowRestore) -> Result<String, CoreError> {
    if branch::current_branch(root)?.as_deref() != Some(restore.head_after.as_str()) {
        return Err(refuse(
            "HEAD is no longer where the finish left it, so undoing would also move later work",
        ));
    }
    if tracked_changes(root)? {
        return Err(CoreError::LocalChanges {
            detail: "Undo needs a clean working tree; commit or stash your changes first."
                .to_owned(),
        });
    }
    if ref_exists(root, &format!("refs/heads/{}", restore.branch))? {
        return Err(refuse(format!("{} exists again", restore.branch)));
    }
    for entry in &restore.moved {
        if tip(root, &entry.name)?.map(|(_, sha)| sha).as_deref() != Some(entry.from.as_str()) {
            return Err(refuse(format!(
                "{} has new commits, so moving it back would discard them",
                entry.name
            )));
        }
    }
    if let Some((name, sha)) = &restore.tag {
        let current = git::run_unchecked(root, &["rev-parse", &format!("refs/tags/{name}")], None)?;
        if !current.succeeded() || current.stdout.trim() != sha {
            return Err(refuse(format!("tag {name} changed since the finish")));
        }
    }
    git::run(
        root,
        &["branch", "--quiet", &restore.branch, &restore.branch_sha],
    )?;
    match &restore.head_before {
        HeadRef::Branch(name) => switch(root, name)?,
        HeadRef::Detached(sha) => {
            git::run(root, &["switch", "--quiet", "--detach", sha])?;
        }
    }
    for entry in &restore.moved {
        git::run(
            root,
            &[
                "update-ref",
                "-m",
                "Undo Git Flow finish",
                &format!("refs/heads/{}", entry.name),
                &entry.to,
                &entry.from,
            ],
        )?;
    }
    if let Some((name, _)) = &restore.tag {
        git::run(root, &["tag", "--delete", name])?;
    }
    Ok(format!(
        "Restored {} at {}",
        restore.branch,
        short(&restore.branch_sha)
    ))
}
