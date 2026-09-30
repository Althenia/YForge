export function Mark(props: { size: number }) {
  const small = () => props.size < 40;
  return (
    <svg class="brand-mark" width={props.size} height={props.size} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect width="1024" height="1024" rx="176" fill="#24282f" />
      <rect x="4" y="4" width="1016" height="1016" rx="172" fill="none" stroke="#3a404a" stroke-width="8" />
      <polygon points="196,194 348,194 602,542 422,542" fill="#67d7a4" />
      <polygon points="676,194 830,194 602,540 602,826 424,826 424,456 479,456" fill="#f2f3f5" />
      {small() ? (
        <>
          <path d="M602 612h124a56 56 0 0 1 56 56v60" fill="none" stroke="#67d7a4" stroke-width="88" />
          <circle cx="782" cy="742" r="96" fill="#f0be62" />
        </>
      ) : (
        <>
          <path d="M602 620h112a60 60 0 0 1 60 60v70" fill="none" stroke="#67d7a4" stroke-width="64" />
          <circle cx="774" cy="750" r="76" fill="#f0be62" />
        </>
      )}
    </svg>
  );
}
