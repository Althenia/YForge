import { onMount } from "solid-js";
import { findLabel, type PageFind } from "../state/find";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function FindBar(props: { find: PageFind; name: string; top: number }) {
  let input: HTMLInputElement | undefined;
  onMount(() => {
    input?.focus();
    input?.select();
  });
  return (
    <div
      class="searchbar findbar"
      role="search"
      aria-label={`Find in ${props.name}`}
      style={{ "margin-top": `${props.top}px` }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.find.close();
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) props.find.previous();
          else props.find.next();
        }
      }}
    >
      <label class="input">
        <Icon name="search" />
        <input
          type="text"
          ref={input}
          aria-label={`Find in ${props.name}`}
          placeholder={`Find in ${props.name}`}
          value={props.find.state().query}
          onInput={(event) => props.find.setQuery(event.currentTarget.value)}
        />
      </label>
      <span class="search-count" role="status" aria-live="polite">
        {findLabel(props.find.state())}
      </span>
      <button type="button" class="icon-btn dense" {...tip("Previous match", "⇧⌘G")} onClick={props.find.previous}>
        <Icon name="previous" />
      </button>
      <button type="button" class="icon-btn dense" {...tip("Next match", "⌘G")} onClick={props.find.next}>
        <Icon name="next" />
      </button>
      <button type="button" class="icon-btn dense" {...tip("Close find", "Esc")} onClick={() => props.find.close()}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
