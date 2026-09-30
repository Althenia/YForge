import { onMount, Show } from "solid-js";
import type { Search } from "../state/search";
import { searchFootnote, searchLabel } from "../state/searchModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function SearchBar(props: { search: Search; onClosed: () => void }) {
  let input: HTMLInputElement | undefined;
  onMount(() => {
    input?.focus();
    input?.select();
  });
  const close = () => {
    props.search.close();
    props.onClosed();
  };
  return (
    <div
      class="searchbar"
      role="search"
      aria-label="Search commits"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) props.search.previous();
          else props.search.next();
        }
      }}
    >
      <label class="input">
        <Icon name="search" />
        <input
          type="text"
          ref={input}
          aria-label="Search commits by message, SHA, or author"
          placeholder="Search message, SHA, or author"
          value={props.search.state().query}
          onInput={(event) => props.search.setQuery(event.currentTarget.value)}
        />
      </label>
      <span class="search-count" role="status" aria-live="polite">
        {searchLabel(props.search.state())}
      </span>
      <button type="button" class="icon-btn dense" {...tip("Previous match", "⇧⌘G")} onClick={props.search.previous}>
        <Icon name="previous" />
      </button>
      <button type="button" class="icon-btn dense" {...tip("Next match", "⌘G")} onClick={props.search.next}>
        <Icon name="next" />
      </button>
      <Show when={searchFootnote(props.search.state())}>{(text) => <span class="search-foot">{text()}</span>}</Show>
      <button type="button" class="icon-btn dense" {...tip("Close search", "Esc")} onClick={close}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
