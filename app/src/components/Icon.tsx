import type { JSX } from "solid-js";
import type { IconName } from "../iconNames";

const glyphs: Record<IconName, () => JSX.Element> = {
  local: () => (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  remote: () => <path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z" />,
  tag: () => (
    <>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  worktree: () => <path d="M12 21V11M12 11 6 5M12 11l6-6" />,
  check: () => <path d="M4 12.5 9.5 18 20 6" />,
  stash: () => <path d="M4 9h16v11H4zM7 4h10l3 5H4zM9 14h6" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  settings: () => (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" />,
  chevron: () => <path d="m6 9 6 6 6-6" />,
  warning: () => <path d="M12 4 2.5 20h19zM12 10v4.5M12 17.5v.01" />,
  more: () => <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  folder: () => <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  close: () => <path d="m6 6 12 12M18 6 6 18" />,
  undo: () => <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12" />,
  lock: () => (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  key: () => (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5" />
    </>
  ),
  copy: () => (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  minus: () => <path d="M5 12h14" />,
  sync: () => <path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.5 5.8L4 15.5M4 20v-4.5h4.5" />,
  fetch: () => <path d="M12 4v10M7.5 10 12 14.5 16.5 10M4 15v4.5a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V15" />,
  pull: () => <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />,
  push: () => <path d="M12 20V8M7 13l5-5 5 5M5 4h14" />,
  branch: () => (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="8.5" r="2" />
      <path d="M6 7.5v9M18 10.5c0 3.5-3 5-8.5 6.3" />
    </>
  ),
  commit: () => (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M3 12h5.5M15.5 12H21" />
    </>
  ),
  merge: () => (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="15" r="2" />
      <path d="M6 7.5v9M6 7.5c0 5 12 2 12 5.5" />
    </>
  ),
  trash: () => <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  diff: () => (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M8 9h6M11 6v6M8 16.5h8" />
    </>
  ),
  edit: () => <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19zM14.5 6.5l3 3" />,
  terminal: () => (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m7.5 10 3 2-3 2M13 15h3.5" />
    </>
  ),
  previous: () => <path d="M12 19V5M6 11l6-6 6 6" />,
  next: () => <path d="M12 5v14M6 13l6 6 6-6" />,
  activity: () => <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  theme: () => (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M12 8h2.5M12 12h3.5M12 16h2.5" />
    </>
  ),
  changes: () => <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9.5 12h5M9.5 16h5" />,
};

const strokeFor = (size: number): number => (size <= 16 ? 1.5 : 1.6);

export function Icon(props: { name: IconName; size?: 14 | 16 | 20 }) {
  const size = () => props.size ?? 16;
  return (
    <svg
      class="icon"
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeFor(size())}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {glyphs[props.name]()}
    </svg>
  );
}
