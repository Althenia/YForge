use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AppInfo {
    pub app_version: String,
    pub git_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Head {
    Branch { name: String, sha: String },
    Detached { sha: String },
    Unborn { branch: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct AheadBehind {
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Upstream {
    pub name: String,
    pub ahead_behind: Option<AheadBehind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ChangeArea {
    Staged,
    Unstaged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct FileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub area: ChangeArea,
    pub status: FileStatus,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
pub struct ChangeCounts {
    pub modified: u32,
    pub added: u32,
    pub deleted: u32,
    pub renamed: u32,
    pub untracked: u32,
    pub conflicted: u32,
}

impl ChangeCounts {
    pub fn total(&self) -> u32 {
        self.modified + self.added + self.deleted + self.renamed + self.untracked + self.conflicted
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    CherryPickSequence,
    RevertSequence,
    Bisect,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct WorktreeStatus {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
    pub current: bool,
    pub dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorktreeIntegration {
    Integrated {
        target_sha: String,
        cleaned_up: bool,
    },
    Conflicts {
        worktree: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct StashEntry {
    pub index: u32,
    pub sha: String,
    pub base_sha: Option<String>,
    pub author_name: String,
    pub message: String,
    pub time: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct OperationStep {
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct OperationDetail {
    pub current: String,
    pub incoming: Option<String>,
    pub message: String,
    pub step: Option<OperationStep>,
    pub resolved: Vec<String>,
    #[ts(optional = nullable)]
    pub stopped_edit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RepoSnapshot {
    pub root: String,
    pub head: Head,
    pub upstream: Option<Upstream>,
    pub counts: ChangeCounts,
    pub files: Vec<FileChange>,
    pub operation: Option<Operation>,
    pub operation_detail: Option<OperationDetail>,
    pub last_fetch: Option<i64>,
    pub worktrees: Vec<Worktree>,
    pub branches: Vec<String>,
    pub remote_branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
    pub stashes: Vec<StashEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct GraphRef {
    pub name: String,
    pub kind: RefKind,
    pub is_head: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Commit,
    Merge,
    Stash,
    Changes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Author {
    pub name: String,
    pub initials: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct GraphEdge {
    pub lane: u32,
    pub parent_row: Option<u32>,
    pub parent_column: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct GraphRow {
    pub sha: Option<String>,
    pub parents: Vec<String>,
    pub summary: String,
    pub author: Option<Author>,
    pub time: Option<i64>,
    pub refs: Vec<GraphRef>,
    pub kind: NodeKind,
    pub column: u32,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SearchResult {
    pub total: u32,
    pub rows: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CarriedEdge {
    pub row: u32,
    pub column: u32,
    pub kind: NodeKind,
    pub edge: GraphEdge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct GraphPage {
    pub rows: Vec<GraphRow>,
    pub carried: Vec<CarriedEdge>,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_number: Option<u32>,
    pub new_number: Option<u32>,
    pub text: String,
    pub no_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub heading: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct FileDiff {
    pub path: String,
    pub original_path: Option<String>,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AmendInfo {
    pub sha: String,
    pub summary: String,
    pub description: String,
    pub pushed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct MessageEdit {
    pub sha: String,
    pub pushed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Signature {
    pub name: String,
    pub email: String,
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CommitFile {
    pub path: String,
    pub original_path: Option<String>,
    pub status: FileStatus,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CommitDetails {
    pub sha: String,
    pub summary: String,
    pub body: String,
    pub author: Signature,
    pub committer: Signature,
    pub parents: Vec<String>,
    pub refs: Vec<GraphRef>,
    pub files: Vec<CommitFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RepoChanged {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CommitBrief {
    pub sha: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CheckoutTarget {
    LocalBranch { name: String },
    RemoteBranch { name: String },
    Tag { name: String },
    Commit { sha: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StashRestore {
    Applied,
    Conflicts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AutoStash {
    None,
    Restored,
    Conflicts,
    Kept,
    Stashed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct CheckoutOutcome {
    pub auto_stash: AutoStash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PullMode {
    FastForwardOnly,
    FastForwardOrMerge,
    Rebase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PullOutcome {
    UpToDate,
    Updated,
    Conflicts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StashKeptReason {
    PullConflicts,
    RestoreConflicts,
    RestoreFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PullStash {
    None,
    Restored,
    Kept {
        reference: String,
        sha: String,
        reason: StashKeptReason,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct PullReport {
    pub outcome: PullOutcome,
    pub stash: PullStash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SwitchStash {
    pub branch: String,
    pub sha: String,
    pub message: String,
    pub created_at: i64,
    pub index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum OperationOutcome {
    Completed,
    Conflicts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ForceLease {
    pub remote: String,
    pub branch: String,
    pub remote_ref: String,
    pub expected_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PushTarget {
    pub remote: String,
    pub name: String,
    pub set_upstream: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ForcePushPlan {
    pub lease: ForceLease,
    pub upstream: String,
    pub replaced: Vec<CommitBrief>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct OperationProgress {
    pub id: String,
    pub phase: String,
    pub percent: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AuthPromptEvent {
    pub operation: String,
    pub prompt: crate::askpass::AuthPrompt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum MergeMode {
    FastForward,
    MergeCommit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RevisionRange {
    pub count: u32,
    pub commits: Vec<CommitBrief>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct IntegrationPreview {
    pub incoming: RevisionRange,
    pub outgoing: RevisionRange,
    pub fast_forward: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ConflictSide {
    Current,
    Incoming,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConflictSegment {
    Text {
        lines: Vec<String>,
    },
    Conflict {
        current: Vec<String>,
        incoming: Vec<String>,
        base: Option<Vec<String>>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct ConflictSides {
    pub base: bool,
    pub current: bool,
    pub incoming: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ConflictFile {
    pub file: String,
    pub eol: String,
    pub final_newline: bool,
    pub binary: bool,
    pub sides: ConflictSides,
    pub segments: Vec<ConflictSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RebaseTodo {
    pub sha: String,
    pub summary: String,
    pub author: Author,
    pub is_merge: bool,
    pub pushed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RebasePlan {
    pub base: String,
    pub commits: Vec<RebaseTodo>,
    pub pushed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RebaseStep {
    Pick { sha: String },
    Reword { sha: String, message: String },
    Squash { sha: String, message: String },
    Fixup { sha: String },
    Drop { sha: String },
    Edit { sha: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RebaseOutcome {
    Completed,
    Conflicts,
    StoppedToEdit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RebaseResult {
    pub outcome: RebaseOutcome,
    pub pushed: bool,
    pub dropped_all: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RecomposeHunk {
    pub id: String,
    pub hunk: DiffHunk,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RecomposeFile {
    pub path: String,
    pub status: FileStatus,
    pub binary: bool,
    pub whole_file_only: bool,
    pub hunks: Vec<RecomposeHunk>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RecomposePreview {
    pub base: String,
    pub head: String,
    pub pushed: bool,
    pub files: Vec<RecomposeFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecomposeChange {
    File { path: String },
    Hunk { id: String },
    Lines { id: String, lines: Vec<u32> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RecomposeGroup {
    pub message: String,
    pub changes: Vec<RecomposeChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RecomposeResult {
    pub head: String,
    pub pushed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ReflogEntry {
    pub index: u32,
    pub selector: String,
    pub sha: String,
    pub previous_sha: Option<String>,
    pub action: String,
    pub message: String,
    pub time: i64,
    pub summary: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum LostKind {
    Commit,
    Stash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct LostCommit {
    pub sha: String,
    pub summary: String,
    pub author: String,
    pub time: i64,
    pub kind: LostKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SnapshotInfo {
    #[serde(rename = "ref")]
    pub reference: String,
    pub time: i64,
    pub action: String,
    pub description: String,
    pub head_sha: Option<String>,
    pub branch: Option<String>,
    pub files_changed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SnapshotChange {
    pub path: String,
    pub status: FileStatus,
}
