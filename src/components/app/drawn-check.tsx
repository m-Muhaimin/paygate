const CHECK_CSS = `
@keyframes pg-check-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
.pg-check__path { stroke-dasharray: 1; stroke-dashoffset: 0; animation: pg-check-draw 520ms cubic-bezier(.2,.8,.2,1) 80ms both; }
`;

/** Success check that draws itself in. Motion collapses under reduced-motion. */
export function DrawnCheck() {
  return (
    <span className="grid size-16 place-items-center rounded-gate-pill bg-gate-success/10">
      <style dangerouslySetInnerHTML={{ __html: CHECK_CSS }} />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="size-8 text-gate-success"
      >
        <path
          className="pg-check__path"
          d="M5 12.5 10 17.5 19 7"
          pathLength={1}
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}