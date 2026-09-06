/**
 * The mark for the terminal build: a square bracket closing on a filled
 * block — a slot on a board with something in it. Deliberately nothing like
 * the two-circle glyph the other build uses, since the two share a name and
 * should not share a logo.
 */
export default function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M8.5 3H4.5C3.67157 3 3 3.67157 3 4.5V19.5C3 20.3284 3.67157 21 4.5 21H8.5"
        stroke="currentColor" strokeWidth="2" strokeLinecap="square"
      />
      <path
        d="M15.5 3H19.5C20.3284 3 21 3.67157 21 4.5V19.5C21 20.3284 20.3284 21 19.5 21H15.5"
        stroke="currentColor" strokeWidth="2" strokeLinecap="square"
      />
      <rect x="9.5" y="9.5" width="5" height="5" fill="var(--accent)" />
    </svg>
  );
}
