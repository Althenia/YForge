import { createUniqueId, type JSX } from "solid-js";

export function DialogFrame(props: { title: string; children: JSX.Element; onEscape: () => void }) {
  const titleId = createUniqueId();
  return (
    <div class="scrim" onPointerDown={(event) => event.target === event.currentTarget && props.onEscape()}>
      <div
        class="dialog entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onEscape();
          }
        }}
      >
        <h3 id={titleId}>{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}
