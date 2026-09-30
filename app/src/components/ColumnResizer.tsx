import { createSignal } from "solid-js";

export function ColumnResizer(props: {
  label: string;
  side: "start" | "end";
  size: number;
  min: number;
  max: number;
  clamp: (size: number) => number;
  onPreview: (size: number | undefined) => void;
  onCommit: (size: number) => void;
  onReset: () => void;
}) {
  const [origin, setOrigin] = createSignal<{ x: number; size: number } | undefined>();
  let latest: number | undefined;
  const direction = () => (props.side === "end" ? 1 : -1);
  const KEY_STEP = 8;
  return (
    <span
      class="gresize"
      classList={{ start: props.side === "start", end: props.side === "end", dragging: origin() !== undefined }}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${props.label} column`}
      aria-valuenow={props.size}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabindex="0"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        latest = undefined;
        setOrigin({ x: event.clientX, size: props.size });
      }}
      onPointerMove={(event) => {
        const start = origin();
        if (start === undefined) return;
        latest = props.clamp(start.size + direction() * (event.clientX - start.x));
        props.onPreview(latest);
      }}
      onPointerUp={() => {
        setOrigin(undefined);
        props.onPreview(undefined);
        if (latest !== undefined) props.onCommit(latest);
      }}
      onPointerCancel={() => {
        setOrigin(undefined);
        props.onPreview(undefined);
      }}
      onDblClick={props.onReset}
      onKeyDown={(event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : undefined;
        if (step !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          props.onCommit(props.clamp(props.size + step * direction() * KEY_STEP));
        } else if (event.key === "Home") {
          event.preventDefault();
          event.stopPropagation();
          props.onReset();
        }
      }}
    />
  );
}
