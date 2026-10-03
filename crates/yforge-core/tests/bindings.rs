use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use ts_rs::{Config, TS};
use yforge_core::EditableFile;
use yforge_core::{
    ActivityEntry, AmendInfo, AppInfo, AppSettings, AppUiPrefs, AuthPromptEvent, AuthReply,
    CheckoutOutcome, CheckoutTarget, CloneOptions, CommitBrief, CommitDetails, ConflictFile,
    ConflictSide, CrashRecord, CrashReport, ErrorPayload, FileDiff, ForceLease, ForcePushPlan,
    GraphPage, Identity, IdentityField, IntegrationPreview, MergeMode, OperationKind,
    OperationOutcome, OperationProgress, PullMode, PullOutcome, RecentRepo, RecentStatus,
    RemoteInfo, RepoChanged, RepoSettings, RepoSnapshot, ResetMode, SearchResult, StashRestore,
    TabSession, UsageRecord,
};
use yforge_core::{
    AiFeature, AiFeatureConfig, AiFeatureSummary, AiSignInEvent, AiSignInMethod, ApiKeyChange,
    AuthMode, CommitDraft, ConflictProposal, ModelInfo, ProviderConfig, ProviderInput,
    ProviderStatus, ProviderSummary, ProviderUpdate, RecomposeProposal,
};
use yforge_core::{BatchOutcome, StashTarget};
use yforge_core::{BlameRun, FileListMode, FileRevision};
use yforge_core::{
    CliInstall, FileAtRevision, GraphVisibility, OpenPathRequested, RepoAlias, RepoUiPrefs,
    StashDetails, UpdateCheck,
};
use yforge_core::{ComposeGroup, ComposeProposal, Explanation, ExplanationItem, StashDraft};
use yforge_core::{
    CreatePull, MatchedRepo, PlatformConnection, PlatformKind, PrDetail, PrFile, PrState,
    PullRequest, RepoRef,
};
use yforge_core::{
    DiffToolSource, ExternalToolsStatus, LfsStatus, Profile, ProfileDraft, ProfileList,
    SigningConfig, SigningFormat, SigningKey, SigningScope, ToolChoices, ToolEntry, ToolsDetected,
};
use yforge_core::{
    FlowFinished, FlowKind, GitFlowConfig, HookList, HookMode, HookOutcome, HookOutput, HookScript,
};
use yforge_core::{
    FolderRemoved, FolderScan, FoundRepo, ManagedRepo, RepoRemoved, Repositories, Rescan,
    ScannedFolder,
};
use yforge_core::{GitHost, GitHostDraft, GitHostProblem, IdentitySource, Transport, UrlIdentity};
use yforge_core::{
    JiraConnection, JiraIssue, JiraIssueList, JiraIssueLookup, JiraKind, JiraProject,
    JiraStatusCategory, LaunchpadPull, LaunchpadPulls, PullList, PullRole, Wip,
};
use yforge_core::{LostCommit, ReflogEntry, SnapshotChange, SnapshotInfo};
use yforge_core::{
    MessageEdit, PullReport, PushTarget, SshKey, Submodule, SwitchStash, WorktreeIntegration,
    WorktreeStatus,
};
use yforge_core::{
    RebaseOutcome, RebasePlan, RebaseResult, RebaseStep, RecomposeChange, RecomposeGroup,
    RecomposePreview, RecomposeResult,
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
    CloneOptions::export_all(&config).expect("export CloneOptions");
    CommitBrief::export_all(&config).expect("export CommitBrief");
    BatchOutcome::export_all(&config).expect("export BatchOutcome");
    StashTarget::export_all(&config).expect("export StashTarget");
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
    yforge_core::RedoChange::export_all(&config).expect("export RedoChange");
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
    MessageEdit::export_all(&config).expect("export MessageEdit");
    PullReport::export_all(&config).expect("export PullReport");
    PushTarget::export_all(&config).expect("export PushTarget");
    SshKey::export_all(&config).expect("export SshKey");
    GitHost::export_all(&config).expect("export GitHost");
    GitHostDraft::export_all(&config).expect("export GitHostDraft");
    GitHostProblem::export_all(&config).expect("export GitHostProblem");
    IdentitySource::export_all(&config).expect("export IdentitySource");
    Transport::export_all(&config).expect("export Transport");
    UrlIdentity::export_all(&config).expect("export UrlIdentity");
    SwitchStash::export_all(&config).expect("export SwitchStash");
    WorktreeIntegration::export_all(&config).expect("export WorktreeIntegration");
    WorktreeStatus::export_all(&config).expect("export WorktreeStatus");
    Submodule::export_all(&config).expect("export Submodule");
    HookList::export_all(&config).expect("export HookList");
    HookScript::export_all(&config).expect("export HookScript");
    HookMode::export_all(&config).expect("export HookMode");
    HookOutput::export_all(&config).expect("export HookOutput");
    HookOutcome::export_all(&config).expect("export HookOutcome");
    GitFlowConfig::export_all(&config).expect("export GitFlowConfig");
    FlowKind::export_all(&config).expect("export FlowKind");
    FlowFinished::export_all(&config).expect("export FlowFinished");
    RebasePlan::export_all(&config).expect("export RebasePlan");
    RebaseStep::export_all(&config).expect("export RebaseStep");
    RebaseOutcome::export_all(&config).expect("export RebaseOutcome");
    RebaseResult::export_all(&config).expect("export RebaseResult");
    RecomposePreview::export_all(&config).expect("export RecomposePreview");
    RecomposeChange::export_all(&config).expect("export RecomposeChange");
    RecomposeGroup::export_all(&config).expect("export RecomposeGroup");
    RecomposeResult::export_all(&config).expect("export RecomposeResult");
    ProviderConfig::export_all(&config).expect("export ProviderConfig");
    ProviderInput::export_all(&config).expect("export ProviderInput");
    ProviderUpdate::export_all(&config).expect("export ProviderUpdate");
    ApiKeyChange::export_all(&config).expect("export ApiKeyChange");
    ProviderStatus::export_all(&config).expect("export ProviderStatus");
    ProviderSummary::export_all(&config).expect("export ProviderSummary");
    ModelInfo::export_all(&config).expect("export ModelInfo");
    AuthMode::export_all(&config).expect("export AuthMode");
    AiFeature::export_all(&config).expect("export AiFeature");
    AiFeatureConfig::export_all(&config).expect("export AiFeatureConfig");
    AiFeatureSummary::export_all(&config).expect("export AiFeatureSummary");
    AiSignInMethod::export_all(&config).expect("export AiSignInMethod");
    AiSignInEvent::export_all(&config).expect("export AiSignInEvent");
    CommitDraft::export_all(&config).expect("export CommitDraft");
    RecomposeProposal::export_all(&config).expect("export RecomposeProposal");
    ConflictProposal::export_all(&config).expect("export ConflictProposal");
    ReflogEntry::export_all(&config).expect("export ReflogEntry");
    LostCommit::export_all(&config).expect("export LostCommit");
    SnapshotInfo::export_all(&config).expect("export SnapshotInfo");
    SnapshotChange::export_all(&config).expect("export SnapshotChange");
    FileAtRevision::export_all(&config).expect("export FileAtRevision");
    EditableFile::export_all(&config).expect("export EditableFile");
    GraphVisibility::export_all(&config).expect("export GraphVisibility");
    StashDetails::export_all(&config).expect("export StashDetails");
    RepoUiPrefs::export_all(&config).expect("export RepoUiPrefs");
    RepoAlias::export_all(&config).expect("export RepoAlias");
    UpdateCheck::export_all(&config).expect("export UpdateCheck");
    AppUiPrefs::export_all(&config).expect("export AppUiPrefs");
    OpenPathRequested::export_all(&config).expect("export OpenPathRequested");
    CliInstall::export_all(&config).expect("export CliInstall");
    PlatformKind::export_all(&config).expect("export PlatformKind");
    PlatformConnection::export_all(&config).expect("export PlatformConnection");
    RepoRef::export_all(&config).expect("export RepoRef");
    PrState::export_all(&config).expect("export PrState");
    PullRequest::export_all(&config).expect("export PullRequest");
    PrFile::export_all(&config).expect("export PrFile");
    PrDetail::export_all(&config).expect("export PrDetail");
    CreatePull::export_all(&config).expect("export CreatePull");
    MatchedRepo::export_all(&config).expect("export MatchedRepo");
    JiraKind::export_all(&config).expect("export JiraKind");
    JiraProject::export_all(&config).expect("export JiraProject");
    JiraConnection::export_all(&config).expect("export JiraConnection");
    JiraStatusCategory::export_all(&config).expect("export JiraStatusCategory");
    JiraIssue::export_all(&config).expect("export JiraIssue");
    JiraIssueLookup::export_all(&config).expect("export JiraIssueLookup");
    PullRole::export_all(&config).expect("export PullRole");
    LaunchpadPull::export_all(&config).expect("export LaunchpadPull");
    LaunchpadPulls::export_all(&config).expect("export LaunchpadPulls");
    PullList::export_all(&config).expect("export PullList");
    JiraIssueList::export_all(&config).expect("export JiraIssueList");
    Wip::export_all(&config).expect("export Wip");
    ScannedFolder::export_all(&config).expect("export ScannedFolder");
    ManagedRepo::export_all(&config).expect("export ManagedRepo");
    Repositories::export_all(&config).expect("export Repositories");
    FoundRepo::export_all(&config).expect("export FoundRepo");
    FolderScan::export_all(&config).expect("export FolderScan");
    Rescan::export_all(&config).expect("export Rescan");
    FolderRemoved::export_all(&config).expect("export FolderRemoved");
    RepoRemoved::export_all(&config).expect("export RepoRemoved");
    FileRevision::export_all(&config).expect("export FileRevision");
    BlameRun::export_all(&config).expect("export BlameRun");
    FileListMode::export_all(&config).expect("export FileListMode");
    Explanation::export_all(&config).expect("export Explanation");
    ExplanationItem::export_all(&config).expect("export ExplanationItem");
    ComposeGroup::export_all(&config).expect("export ComposeGroup");
    ComposeProposal::export_all(&config).expect("export ComposeProposal");
    StashDraft::export_all(&config).expect("export StashDraft");
    ToolChoices::export_all(&config).expect("export ToolChoices");
    ToolEntry::export_all(&config).expect("export ToolEntry");
    ToolsDetected::export_all(&config).expect("export ToolsDetected");
    ExternalToolsStatus::export_all(&config).expect("export ExternalToolsStatus");
    DiffToolSource::export_all(&config).expect("export DiffToolSource");
    LfsStatus::export_all(&config).expect("export LfsStatus");
    SigningScope::export_all(&config).expect("export SigningScope");
    SigningFormat::export_all(&config).expect("export SigningFormat");
    SigningConfig::export_all(&config).expect("export SigningConfig");
    SigningKey::export_all(&config).expect("export SigningKey");
    Profile::export_all(&config).expect("export Profile");
    ProfileList::export_all(&config).expect("export ProfileList");
    ProfileDraft::export_all(&config).expect("export ProfileDraft");
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
