import { useMutation } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { RecomposeGroup } from "../ipc/bindings/RecomposeGroup";
import { client, IpcError } from "../ipc/client";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { createAiRun } from "../state/aiRun";
import { fileList } from "../state/fileList";
import { statusIcon, statusWord } from "../state/changes";
import { beginPointerDrag } from "../state/pointerDrag";
import { historyKeys } from "../state/queryKeys";
import { dirtyReason } from "../state/rebaseModel";
import {
  addGroup,
  assign,
  catalogOf,
  describeGroup,
  fromGroups,
  groupOf,
  groupsOf,
  moveGroup,
  newDraft,
  problemsOf,
  progressOf,
  removeGroup,
  renameGroup,
  type Draft,
  type FileUnit,
  type HunkUnit,
  type Target,
} from "../state/recomposeModel";
import type { MenuState } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { tip } from "./Tooltip";
import { fileRowHeight, VirtualRows } from "./VirtualRows";

const short = (sha: string) => sha.slice(0, 7);

const UPSTREAM = "upstream";

const isTyping = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

const hunkLabel = (unit: HunkUnit) => `@@ -${unit.hunk.old_start},${unit.hunk.old_lines} +${unit.hunk.new_start},${unit.hunk.new_lines} @@`;

export function RecomposeView(props: { session: RepoSession; base: string | undefined; onClose: () => void; onOpenAiSettings: () => void }) {
  const path = props.session.path;
  const snapshot = () => props.session.snapshot();
  const upstream = () => snapshot().upstream?.name;
  const upstreamRef = () => {
    const name = upstream();
    return name === undefined ? undefined : `${snapshot().remote_branches.includes(name) ? "refs/remotes" : "refs/heads"}/${name}`;
  };
  const [choice, setChoice] = createSignal<string | undefined>(props.base ?? (upstream() === undefined ? undefined : UPSTREAM));
  const baseRef = () => (choice() === UPSTREAM ? upstreamRef() : choice());
  const choices = useQuery(
    () => ({ queryKey: historyKeys.baseChoices(path), queryFn: () => client.repoGraph(path, 0, 100), staleTime: Infinity, gcTime: 0 }),
    () => props.session.queryClient,
  );
  const chain = createMemo(() => {
    const rows = new Map((choices.data?.rows ?? []).flatMap((row) => (row.sha === null ? [] : [[row.sha, row] as const])));
    const found: Array<{ sha: string; summary: string }> = [];
    const head = snapshot().head;
    let next: string | undefined = head.kind === "unborn" ? undefined : head.sha;
    while (next !== undefined && rows.has(next)) {
      const row = rows.get(next);
      if (row === undefined) break;
      found.push({ sha: next, summary: row.summary });
      next = row.parents[0];
    }
    return found.slice(1);
  });

  const preview = useQuery(
    () => ({ queryKey: historyKeys.recompose(path, baseRef() ?? ""), queryFn: () => client.recomposePreview(path, baseRef() as string), enabled: baseRef() !== undefined, staleTime: Infinity, gcTime: 0, retry: false }),
    () => props.session.queryClient,
  );
  const loaded = () => (preview.error == null ? preview.data : undefined);
  const catalog = createMemo(() => (loaded() === undefined ? [] : catalogOf(loaded() as NonNullable<ReturnType<typeof loaded>>)));
  const [draft, setDraft] = createSignal<Draft>(newDraft());
  const [previous, setPrevious] = createSignal<Draft | undefined>();
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = createSignal<Record<string, readonly number[]>>({});
  const [menu, setMenu] = createSignal<MenuState | undefined>();
  const [dropGroup, setDropGroup] = createSignal<number | undefined>();
  const [withheld, setWithheld] = createSignal<string[]>([]);
  const [failure, setFailure] = createSignal<IpcError | undefined>();
  const [focusedFile, setFocusedFile] = createSignal<string | undefined>();
  let scroller: HTMLDivElement | undefined;

  createEffect(
    on(loaded, () => {
      setDraft(newDraft());
      setPrevious(undefined);
      setExpanded(new Set<string>());
      setSelected({});
    }),
  );

  const groupIds = createMemo(() => draft().groups.map((group) => group.id));
  const problems = createMemo(() => problemsOf(draft(), catalog()));
  const progress = createMemo(() => progressOf(draft(), catalog()));
  const groupNumber = (id: number) => draft().groups.findIndex((group) => group.id === id) + 1;
  const chipOf = (target: Target): { text: string; assigned: boolean } => {
    const owner = groupOf(draft(), catalog(), target);
    if (owner === undefined) return { text: "Unassigned", assigned: false };
    return owner === "mixed" ? { text: "Split", assigned: true } : { text: `Commit ${groupNumber(owner)}`, assigned: true };
  };

  const proposer = createAiRun(props.session.queryClient, (id) => client.aiProposeRecompose(path, id, baseRef() as string));
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  async function propose(): Promise<void> {
    const proposal = await proposer.start();
    if (proposal === undefined) return;
    setPrevious(draft());
    setDraft(fromGroups(proposal.groups, catalog()));
    setWithheld(proposal.excluded);
  }

  const apply = useMutation(
    () => ({ mutationFn: (groups: RecomposeGroup[]) => client.recomposeApply(path, baseRef() as string, groups) }),
    () => props.session.queryClient,
  );

  const reason = (): string | undefined => {
    if (loaded() === undefined) return preview.error == null ? (baseRef() === undefined ? "Choose a base first" : "Reading the changes…") : "The changes could not be read";
    const group = draft().groups.find((entry) => problems().groups[entry.id] !== undefined);
    return (
      problems().general[0] ??
      (group === undefined ? undefined : `Commit ${groupNumber(group.id)}: ${problems().groups[group.id]}`) ??
      dirtyReason(snapshot().counts) ??
      (apply.isPending ? "Recomposing…" : undefined)
    );
  };

  async function run(): Promise<void> {
    if (reason() !== undefined) return;
    setFailure(undefined);
    try {
      const result = await apply.mutateAsync(groupsOf(draft(), catalog()));
      await props.session.refresh();
      if (result.pushed) props.session.inform("Commits that are already on the upstream were rewritten. The next push needs a force push.");
      props.onClose();
    } catch (error) {
      setFailure(error instanceof IpcError ? error : new IpcError({ kind: "internal", message: String(error) }));
      await props.session.refresh();
    }
  }

  const assignTo = (target: Target, group: number | undefined) => {
    setDraft(assign(draft(), catalog(), target, group));
    if (target.kind === "lines") setSelected({ ...selected(), [target.id]: [] });
  };

  const openAssignMenu = (target: Target, anchor: Element) => {
    const rect = anchor.getBoundingClientRect();
    setMenu({
      anchor: { left: rect.left, top: rect.bottom + 4 },
      entries: [
        ...draft().groups.map((group, index) => ({ kind: "item" as const, id: String(group.id), label: [`Commit ${index + 1}`, group.message.trim() === "" ? "" : ` · ${group.message.split("\n")[0]}`] })),
        { kind: "separator" as const },
        { kind: "item" as const, id: "0", label: ["Unassigned"] },
      ],
      run: (id) => assignTo(target, id === "0" ? undefined : Number(id)),
    });
  };

  const toggle = (key: string) => setExpanded((open) => (open.has(key) ? new Set([...open].filter((entry) => entry !== key)) : new Set([...open, key])));

  const startDrag = (event: PointerEvent, target: Target) => {
    beginPointerDrag<number>(event, {
      hit: (x, y) => {
        const group = document.elementFromPoint(x, y)?.closest<HTMLElement>(".rgroup");
        return group === null || group === undefined ? undefined : Number(group.dataset.group);
      },
      mark: setDropGroup,
      drop: (group) => assignTo(target, group),
    });
  };

  const onUnitKey = (event: KeyboardEvent, target: Target, unit: HTMLElement) => {
    if (isTyping(event.target) || event.altKey || event.metaKey || event.ctrlKey) return;
    if (/^[1-9]$/.test(event.key)) {
      const group = draft().groups[Number(event.key) - 1];
      if (group !== undefined) {
        event.preventDefault();
        assignTo(target, group.id);
      }
    } else if (event.key === "0") {
      event.preventDefault();
      assignTo(target, undefined);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const units = [...(unit.closest(".rchanges")?.querySelectorAll<HTMLElement>("[data-unit]") ?? [])];
      units[units.indexOf(unit) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  };

  const chipView = (target: Target) => (
    <span class="assign-chip chip" classList={{ "chip-success": chipOf(target).assigned, "chip-attention": !chipOf(target).assigned }}>
      <Icon name={chipOf(target).assigned ? "check" : "warning"} size={14} />
      {chipOf(target).text}
    </span>
  );

  const selectLine = (hunk: HunkUnit, line: number) =>
    setSelected({ ...selected(), [hunk.id]: (selected()[hunk.id] ?? []).includes(line) ? (selected()[hunk.id] ?? []).filter((entry) => entry !== line) : [...(selected()[hunk.id] ?? []), line] });

  const HunkRows = (hunkProps: { file: FileUnit; unit: HunkUnit }) => {
    const target: Target = { kind: "hunk", id: hunkProps.unit.id };
    const linesKey = `lines:${hunkProps.unit.id}`;
    const chosen = () => selected()[hunkProps.unit.id] ?? [];
    return (
      <>
        <div class="crow hunk" tabindex="-1" data-unit={`hunk:${hunkProps.unit.id}`} onKeyDown={(event) => onUnitKey(event, target, event.currentTarget)}>
          <button type="button" class="icon-btn dense rgrip" tabindex="-1" {...tip("Drag to a commit", undefined, `Drag ${hunkLabel(hunkProps.unit)} of ${hunkProps.file.path} to a commit`)} onPointerDown={(event) => startDrag(event, target)}>
            <Icon name="grip" />
          </button>
          <button type="button" class="icon-btn dense" tabindex="-1" aria-expanded={expanded().has(linesKey)} {...tip(expanded().has(linesKey) ? "Hide lines" : "Show lines", undefined, `${expanded().has(linesKey) ? "Hide" : "Show"} lines of ${hunkLabel(hunkProps.unit)}`)} onClick={() => toggle(linesKey)}>
            <span class="folder-chevron" classList={{ collapsed: !expanded().has(linesKey) }}>
              <Icon name="chevron" />
            </span>
          </button>
          <span class="ref hunk-label">{hunkLabel(hunkProps.unit)}</span>
          <span class="counts">
            <span class="plus">+{hunkProps.unit.added}</span> <span class="minus">−{hunkProps.unit.removed}</span>
          </span>
          {chipView(target)}
          <button type="button" class="icon-btn dense" tabindex="-1" aria-haspopup="menu" {...tip("Assign to a commit", "1–9", `Assign ${hunkLabel(hunkProps.unit)} of ${hunkProps.file.path} to a commit`)} onClick={(event) => openAssignMenu(target, event.currentTarget)}>
            <Icon name="recompose" />
          </button>
        </div>
        <Show when={expanded().has(linesKey)}>
          <div class="clines" role="group" aria-label={`Lines of ${hunkLabel(hunkProps.unit)}`}>
            <For each={hunkProps.unit.changed}>
              {(index) => {
                const line = hunkProps.unit.hunk.lines[index];
                const added = line?.kind === "added";
                return (
                  <div class="cline" classList={{ added, removed: !added, selected: chosen().includes(index) }}>
                    <button
                      type="button"
                      role="checkbox"
                      class="line-check"
                      aria-checked={chosen().includes(index)}
                      aria-label={`Select ${added ? "added" : "removed"} line ${added ? line?.new_number : line?.old_number}`}
                      onClick={() => selectLine(hunkProps.unit, index)}
                    >
                      <Show when={chosen().includes(index)} fallback={<span aria-hidden="true">{added ? "+" : "−"}</span>}>
                        <Icon name="check" size={14} />
                      </Show>
                    </button>
                    <span class="code">{line?.text}</span>
                  </div>
                );
              }}
            </For>
            <div class="hrow">
              <button
                type="button"
                class="btn sm"
                aria-haspopup="menu"
                aria-label="Assign selected lines"
                disabled={chosen().length === 0}
                title={chosen().length === 0 ? "Select lines first" : undefined}
                onClick={(event) => openAssignMenu({ kind: "lines", id: hunkProps.unit.id, lines: chosen() }, event.currentTarget)}
              >
                <Icon name="recompose" size={14} />
                Assign {chosen().length} selected {chosen().length === 1 ? "line" : "lines"}…
              </button>
            </div>
          </div>
        </Show>
      </>
    );
  };

  const FileRows = (fileProps: { file: FileUnit }) => {
    const target: Target = { kind: "file", path: fileProps.file.path };
    const key = `file:${fileProps.file.path}`;
    return (
      <>
        <div class="crow file" tabindex="0" data-unit={key} onKeyDown={(event) => onUnitKey(event, target, event.currentTarget)}>
          <button type="button" class="icon-btn dense rgrip" tabindex="-1" {...tip("Drag to a commit", undefined, `Drag ${fileProps.file.path} to a commit`)} onPointerDown={(event) => startDrag(event, target)}>
            <Icon name="grip" />
          </button>
          <Show when={!fileProps.file.whole} fallback={<span class="chev-spacer" />}>
            <button type="button" class="icon-btn dense" tabindex="-1" aria-expanded={expanded().has(key)} {...tip(expanded().has(key) ? "Hide hunks" : "Show hunks", undefined, `${expanded().has(key) ? "Hide" : "Show"} hunks of ${fileProps.file.path}`)} onClick={() => toggle(key)}>
              <span class="folder-chevron" classList={{ collapsed: !expanded().has(key) }}>
                <Icon name="chevron" />
              </span>
            </button>
          </Show>
          <span class={`badge st-${fileProps.file.status}`} title={statusWord[fileProps.file.status]} role="img" aria-label={statusWord[fileProps.file.status]}>
            <Icon name={statusIcon[fileProps.file.status]} />
          </span>
          <span class="path-line" title={fileProps.file.path}>
            <bdi dir="ltr">{fileProps.file.path}</bdi>
          </span>
          <Show when={fileProps.file.whole}>
            <span class="hint-text">{fileProps.file.binary ? "binary, whole file" : fileProps.file.omitted === null ? "whole file" : "too large, whole file"}</span>
          </Show>
          {chipView(target)}
          <button type="button" class="icon-btn dense" tabindex="-1" aria-haspopup="menu" {...tip("Assign to a commit", "1–9", `Assign ${fileProps.file.path} to a commit`)} onClick={(event) => openAssignMenu(target, event.currentTarget)}>
            <Icon name="recompose" />
          </button>
        </div>
        <Show when={fileProps.file.omitted}>{(text) => <p class="setting-note">{text()}</p>}</Show>
        <Show when={expanded().has(key)}>
          <For each={fileProps.file.hunks}>{(unit) => <HunkRows file={fileProps.file} unit={unit} />}</For>
        </Show>
      </>
    );
  };

  return (
    <section class="panel rpanel recompose" aria-label="Recompose" aria-busy={apply.isPending} tabindex="-1" onKeyDown={(event) => event.key === "Escape" && !isTyping(event.target) && !menu() && props.onClose()}>
      <div class="rhead">
        <Icon name="recompose" />
        <span>Recompose</span>
        <Show when={baseRef()}>{(base) => <span class="mono">{short(base().startsWith("refs/") ? (upstream() ?? base()) : base())}..HEAD</span>}</Show>
        <Show when={loaded()}>{(current) => <span class="dim">{current().files.length} {current().files.length === 1 ? "file" : "files"}</span>}</Show>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody" ref={scroller}>
        <div class="rtool" role="toolbar" aria-label="Recompose tools">
          <label class="base-pick">
            <span class="field-label">Base</span>
            <Select
              label="Base"
              value={choice() ?? ""}
              options={[
                ...(choice() === undefined ? [{ value: "", label: "Choose a base…" }] : []),
                ...(upstream() === undefined ? [] : [{ value: UPSTREAM, label: `Upstream · ${upstream()}` }]),
                ...(props.base !== undefined && !chain().some((entry) => entry.sha === props.base)
                  ? [{ value: props.base as string, label: `${short(props.base as string)} · chosen commit` }]
                  : []),
                ...chain().map((entry) => ({ value: entry.sha, label: `${short(entry.sha)} · ${entry.summary}` })),
              ]}
              onChange={(value) => setChoice(value === "" ? undefined : value)}
            />
          </label>
          <span class="reason" role="status" aria-live="polite">
            {progress().assigned} of {progress().total} changes assigned
          </span>
          <span class="spacer" />
          <Show when={featureAvailable(features.data, "recompose") || proposer.running()}>
            <Show
              when={proposer.running()}
              fallback={
                <button
                  type="button"
                  class="icon-btn dense ai-btn"
                  {...tip(loaded() === undefined ? "Propose a grouping of these changes into commits. Loading the changes…" : "Propose a grouping of these changes into commits")}
                  aria-disabled={loaded() === undefined ? "true" : undefined}
                  onClick={() => loaded() !== undefined && void propose()}
                >
                  <Icon name="wand" size={14} />
                </button>
              }
            >
              <button type="button" class="icon-btn dense ai-btn" aria-busy="true" disabled {...tip("Proposing a grouping…")}>
                <Icon name="wand" size={14} />
              </button>
              <button type="button" class="icon-btn dense" {...tip("Cancel proposing")} onClick={proposer.cancel}>
                <Icon name="close" size={14} />
              </button>
            </Show>
          </Show>
          <Show when={previous()}>
            <button
              type="button"
              class="btn sm"
              onClick={() => {
                setDraft(previous() as Draft);
                setPrevious(undefined);
                setWithheld([]);
              }}
            >
              <Icon name="undo" size={14} />
              Restore my grouping
            </button>
          </Show>
        </div>
        <Show when={preview.error}>
          {(error) => (
            <div class="graph-error" role="alert">
              {error() instanceof Error ? (error() as Error).message : String(error())}
            </div>
          )}
        </Show>
        <Show when={loaded()?.pushed}>
          <div class="note attention" role="status">
            <Icon name="warning" /> Some of these commits are already on {upstream() ?? "the upstream"}. Recomposing them means the next push needs a force push.
          </div>
        </Show>
        <Show when={proposer.failure()}>
          {(error) => (
            <div class="note danger" role="alert">
              <strong>{error().message}</strong>
              <Show when={error().detail}>{(detail) => <span class="hint-text">{detail()}</span>}</Show>
              <Show when={error().action}>
                {(action) => (
                  <button type="button" class="btn sm" onClick={props.onOpenAiSettings}>
                    <Icon name={action() === "sign_in" ? "key" : "settings"} size={14} />
                    {action() === "sign_in" ? "Sign in" : "Open AI settings"}
                  </button>
                )}
              </Show>
            </div>
          )}
        </Show>
        <Show when={withheld().length > 0}>
          <div class="note attention" role="status">
            Withheld from the provider because they look like secrets: {fileList(withheld())}. Review where they belong.
          </div>
        </Show>
        <div class="rsplit">
          <section class="rchanges" aria-label="Changes to assign">
            <h4>Changes</h4>
            <div role="list">
              <Show when={catalog().length > 0} fallback={<p class="setting-note">{baseRef() === undefined ? "There is no upstream. Choose a base commit to recompose from." : "Nothing to assign yet."}</p>}>
                <VirtualRows as="div" class="clist" measured items={catalog()} scroller={() => scroller} estimate={fileRowHeight()} keepIndex={catalog().findIndex((file) => file.path === focusedFile())}>
                  {(file, virtual) => (
                    <div role="listitem" ref={virtual.measure} style={virtual.style} onFocusIn={() => setFocusedFile(file.path)}>
                      <FileRows file={file} />
                    </div>
                  )}
                </VirtualRows>
              </Show>
            </div>
            <p class="setting-note">Drag a handle onto a commit, or focus a row and press 1–9 for a commit and 0 to unassign.</p>
          </section>
          <section class="rgroups" aria-label="New commits, oldest first">
            <h4>New commits · oldest first</h4>
            <For each={groupIds()}>
              {(id, index) => {
                const group = () => draft().groups.find((entry) => entry.id === id) as { id: number; message: string };
                return (
                <section class="rgroup" classList={{ "drop-target": dropGroup() === id, invalid: problems().groups[id] !== undefined }} data-group={id} aria-label={`Commit ${index() + 1}`}>
                  <div class="rgroup-head">
                    <strong>Commit {index() + 1}</strong>
                    <span class="spacer" />
                    <button type="button" class="icon-btn dense" disabled={index() === 0} title={index() === 0 ? "Already the oldest commit" : undefined} {...tip("Move earlier", undefined, `Move commit ${index() + 1} earlier`)} onClick={() => setDraft(moveGroup(draft(), id, -1))}>
                      <Icon name="previous" />
                    </button>
                    <button type="button" class="icon-btn dense" disabled={index() === draft().groups.length - 1} title={index() === draft().groups.length - 1 ? "Already the newest commit" : undefined} {...tip("Move later", undefined, `Move commit ${index() + 1} later`)} onClick={() => setDraft(moveGroup(draft(), id, 1))}>
                      <Icon name="next" />
                    </button>
                    <button type="button" class="icon-btn dense" disabled={draft().groups.length === 1} title={draft().groups.length === 1 ? "A recomposition needs at least one commit" : undefined} {...tip("Remove commit", undefined, `Remove commit ${index() + 1}`)} onClick={() => setDraft(removeGroup(draft(), id))}>
                      <Icon name="trash" />
                    </button>
                  </div>
                  <label class="input area rmessage">
                    <textarea aria-label={`Message for commit ${index() + 1}`} placeholder="Commit message" spellcheck={false} value={group().message} onInput={(event) => setDraft(renameGroup(draft(), id, event.currentTarget.value))} />
                  </label>
                  <Show when={problems().groups[id]}>{(text) => <span class="field-note error">{text()}</span>}</Show>
                  <ul class="rgroup-items">
                    <For each={describeGroup(draft(), catalog(), id)} fallback={<li class="setting-note">Nothing assigned yet.</li>}>
                      {(item) => (
                        <li>
                          <span class="path-line">
                            <bdi dir="ltr">{item.path}</bdi>
                          </span>
                          <span class="hint-text">{item.scope}</span>
                          <Show when={item.added + item.removed > 0}>
                            <span class="counts">
                              <span class="plus">+{item.added}</span> <span class="minus">−{item.removed}</span>
                            </span>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
                );
              }}
            </For>
            <button type="button" class="btn" onClick={() => setDraft(addGroup(draft()))}>
              <Icon name="plus" />
              Add commit
            </button>
          </section>
        </div>
      </div>
      <div class="rfoot">
        <button type="button" class="btn primary" disabled={reason() !== undefined} onClick={() => void run()}>
          <Icon name="recompose" />
          Recompose {draft().groups.length} {draft().groups.length === 1 ? "commit" : "commits"}
        </button>
        <button type="button" class="btn" onClick={props.onClose}>
          Cancel
        </button>
        <Show when={failure()}>
          {(error) => (
            <span class="field-note error" role="alert">
              {error().message}
              <Show when={error().output}>{(output) => <pre class="out">{output()}</pre>}</Show>
            </span>
          )}
        </Show>
        <Show when={!failure() && reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
      </div>
      <Show when={menu()} keyed>
        {(open) => <ContextMenu menu={open} onClose={() => setMenu(undefined)} />}
      </Show>
    </section>
  );
}
