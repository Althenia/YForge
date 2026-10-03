import { Index, onCleanup, onMount, Show } from "solid-js";
import { composeFoot, composeLabel, composeReason, sheetHeading, sheetRunning, type AiSheet as AiSheetState, type SheetTarget } from "../state/aiSheet";
import { AiFailureNote } from "./AiFailureNote";
import { Icon } from "./Icon";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";

const MESSAGE_MIN_ROWS = 1;
const MESSAGE_MAX_ROWS = 4;

function Sheet(props: { sheet: AiSheetState; target: SheetTarget; onOpenAiSettings: () => void }) {
  const sheet = props.sheet;
  const compose = () => props.target.kind === "compose_commits";
  const reason = () => composeReason(sheet.groups() ?? [], sheet.applying());
  let root: HTMLElement | undefined;

  onMount(() => {
    const opener = document.activeElement;
    root?.focus();
    onCleanup(() => {
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    });
  });

  return (
    <section
      class="ai-sheet"
      ref={root}
      tabindex="-1"
      aria-label={sheetHeading(props.target)}
      aria-busy={sheet.running()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        sheet.close();
      }}
    >
      <div class="ai-sheet-head">
        <Icon name="wand" size={14} />
        <h2>{sheetHeading(props.target)}</h2>
        <span class="ai-tag">{compose() ? "AI draft · nothing changed yet" : "AI explanation · read only"}</span>
        <button type="button" class="icon-btn dense ai-sheet-close" {...tip("Close", "Esc")} onClick={sheet.close}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div class="ai-sheet-body">
        <Show
          when={!sheet.running()}
          fallback={
            <div class="ai-running" role="status">
              <Icon name="wand" size={14} />
              <span>{sheetRunning(props.target)}</span>
              <button type="button" class="btn sm" onClick={sheet.close}>
                <Icon name="close" size={14} />
                Cancel
              </button>
            </div>
          }
        >
          <Show when={sheet.failure()}>{(failure) => <AiFailureNote failure={failure()} onOpenAiSettings={props.onOpenAiSettings} />}</Show>
          <Show when={sheet.items()}>
            {(items) => (
              <Show when={items().length > 0} fallback={<p class="ai-empty">Nothing to explain.</p>}>
                <ul class="ai-items">
                  <Index each={items()}>
                    {(item) => (
                      <li>
                        <span class="ref">{item().path}</span>
                        <span class="ai-text">{item().text}</span>
                      </li>
                    )}
                  </Index>
                </ul>
              </Show>
            )}
          </Show>
          <Show when={sheet.groups()}>
            {(groups) => (
              <>
                <ol class="ai-groups">
                  <Index each={groups()}>
                    {(group, index) => (
                      <li class="ai-group" classList={{ off: !group().include }}>
                        <button
                          type="button"
                          role="checkbox"
                          class="ai-include"
                          aria-checked={group().include}
                          {...tip(`Include commit ${index + 1}`)}
                          onClick={() => sheet.setInclude(group().id, !group().include)}
                        >
                          <Icon name="check" size={14} />
                        </button>
                        <TextArea
                          label={`Message for commit ${index + 1}`}
                          value={group().message}
                          minRows={MESSAGE_MIN_ROWS}
                          maxRows={MESSAGE_MAX_ROWS}
                          onInput={(message) => sheet.setMessage(group().id, message)}
                        />
                        <span class="ai-files ref">{group().files.join(", ")}</span>
                      </li>
                    )}
                  </Index>
                </ol>
                <p class="ai-foot">{composeFoot(groups())}</p>
                <div class="ai-acts">
                  <button type="button" class="btn primary sm" disabled={reason() !== undefined} onClick={() => void sheet.create()}>
                    <Icon name="check" size={14} />
                    <span class="btn-label">{reason() ?? composeLabel(groups())}</span>
                  </button>
                  <button type="button" class="btn sm" disabled={sheet.applying()} onClick={sheet.close}>
                    Discard
                  </button>
                </div>
              </>
            )}
          </Show>
          <Show when={sheet.notes().length > 0}>
            <ul class="draft-notes" role="status">
              <Index each={sheet.notes()}>{(note) => <li>{note()}</li>}</Index>
            </ul>
          </Show>
        </Show>
      </div>
    </section>
  );
}

export function AiSheet(props: { sheet: AiSheetState; onOpenAiSettings: () => void }) {
  return <Show when={props.sheet.target()} keyed>{(target) => <Sheet sheet={props.sheet} target={target} onOpenAiSettings={props.onOpenAiSettings} />}</Show>;
}
