import Image from "next/image";

/**
 * The mark, lifted off its blue plate by scripts/cut-logo.py.
 *
 * The counters are transparent rather than white, so whatever is behind the
 * mark shows through them — which is what makes the pair read as eyes on a
 * dark ground. `size` is the width; the crown makes it wider than it is tall.
 */
const RATIO = 938 / 571;

export default function Mark({ size = 26 }: { size?: number }) {
  return (
    <Image
      src="/brand/mark.png"
      alt=""
      aria-hidden
      width={Math.round(size * RATIO)}
      height={size}
      priority
      style={{ display: "block", height: size, width: "auto", flexShrink: 0 }}
    />
  );
}
