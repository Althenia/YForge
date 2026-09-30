use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use ts_rs::{Config, TS};
use yforge_core::{
    ActivityEntry, AmendInfo, AppInfo, AppSettings, AuthPromptEvent, AuthReply, CheckoutOutcome,
    CheckoutTarget, CommitBrief, CommitDetails, ConflictFile, ConflictSide, CrashRecord,
    CrashReport, ErrorPayload, FileDiff, ForceLease, ForcePushPlan, GraphPage, Identity,
    IdentityField, IntegrationPreview, MergeMode, OperationKind, OperationOutcome,
    OperationProgress, PullMode, PullOutcome, RecentRepo, RecentStatus, RemoteInfo, RepoChanged,
    RepoSettings, RepoSnapshot, ResetMode, SearchResult, StashRestore, TabSession, UsageRecord,
};

fn committed_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/src/ipc/bindings")
}

fn export_all(dir: &Path) {
    let config = Config::new().with_large_int("number").with_out_dir(dir);
    AppInfo::export_all(&config).expect("export AppInfo");
    ErrorPayload::export_all(&config).expect("export ErrorPayload");
    RepoSnapshot::export_all(&config).expect("export RepoSnapshot");
    GraphPage::export_all(&config).expect("export GraphPage");
    FileDiff::export_all(&config).expect("export FileDiff");
    AmendInfo::export_all(&config).expect("export AmendInfo");
    CommitDetails::export_all(&config).expect("export CommitDetails");
    RepoChanged::export_all(&config).expect("export RepoChanged");
    CheckoutTarget::export_all(&config).expect("export CheckoutTarget");
    CheckoutOutcome::export_all(&config).expect("export CheckoutOutcome");
    CommitBrief::export_all(&config).expect("export CommitBrief");
    StashRestore::export_all(&config).expect("export StashRestore");
    PullMode::export_all(&config).expect("export PullMode");
    PullOutcome::export_all(&config).expect("export PullOutcome");
    ForceLease::export_all(&config).expect("export ForceLease");
    ForcePushPlan::export_all(&config).expect("export ForcePushPlan");
    OperationOutcome::export_all(&config).expect("export OperationOutcome");
    OperationProgress::export_all(&config).expect("export OperationProgress");
    MergeMode::export_all(&config).expect("export MergeMode");
    ResetMode::export_all(&config).expect("export ResetMode");
    IntegrationPreview::export_all(&config).expect("export IntegrationPreview");
    ConflictFile::export_all(&config).expect("export ConflictFile");
    ConflictSide::export_all(&config).expect("export ConflictSide");
    ActivityEntry::export_all(&config).expect("export ActivityEntry");
    AppSettings::export_all(&config).expect("export AppSettings");
    RepoSettings::export_all(&config).expect("export RepoSettings");
    AuthPromptEvent::export_all(&config).expect("export AuthPromptEvent");
    AuthReply::export_all(&config).expect("export AuthReply");
    RecentRepo::export_all(&config).expect("export RecentRepo");
    RecentStatus::export_all(&config).expect("export RecentStatus");
    TabSession::export_all(&config).expect("export TabSession");
    Identity::export_all(&config).expect("export Identity");
    IdentityField::export_all(&config).expect("export IdentityField");
    RemoteInfo::export_all(&config).expect("export RemoteInfo");
    SearchResult::export_all(&config).expect("export SearchResult");
    CrashRecord::export_all(&config).expect("export CrashRecord");
    CrashReport::export_all(&config).expect("export CrashReport");
    UsageRecord::export_all(&config).expect("export UsageRecord");
    OperationKind::export_all(&config).expect("export OperationKind");
}

fn read_all(dir: &Path) -> BTreeMap<String, String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return BTreeMap::new();
    };
    entries
        .map(|entry| entry.expect("directory entry").path())
        .map(|path| {
            (
                path.file_name()
                    .expect("file name")
                    .to_string_lossy()
                    .into_owned(),
                fs::read_to_string(&path).expect("binding file"),
            )
        })
        .collect()
}

#[test]
fn committed_typescript_bindings_match_the_rust_types() {
    let committed = committed_dir();
    if std::env::var("UPDATE_BINDINGS").is_ok_and(|value| !value.is_empty()) {
        if committed.exists() {
            fs::remove_dir_all(&committed).expect("clear bindings");
        }
        fs::create_dir_all(&committed).expect("create bindings dir");
        export_all(&committed);
        return;
    }

    let generated = tempfile::tempdir().expect("tempdir");
    export_all(generated.path());

    assert_eq!(
        read_all(generated.path()),
        read_all(&committed),
        "app/src/ipc/bindings is stale: run `pnpm bindings` in app/ and review the diff"
    );
}
