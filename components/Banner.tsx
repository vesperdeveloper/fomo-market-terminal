function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Cover art for a handle, in the brand's periwinkle.
 *
 * The hue is not free: it walks a narrow band either side of the accent so
 * every banner reads as the same family, and only the position within that
 * band, the angle and the highlight placement vary per handle. A full-hue
 * hash gave a wall of unrelated colours that fought the page.
 *
 * The account's own avatar is blurred underneath at low weight - enough to
 * make one card feel like that person's card, not enough to repaint the
 * banner in the avatar's colour, which is what turned these green.
 */
export default function Banner({
  handle, height, avatar,
}: { handle: string; height?: number; avatar?: string }) {
  const h = hash(handle);
  const seed = h % 1000;

  // 256deg .. 300deg: indigo through violet, centred on the accent at 277
  const hue = (256 + (h % 44)) % 360;
  const hue2 = (hue + 14 + ((h >> 8) % 20)) % 360;
  const angle = (h >> 4) % 40;                 // a shallow, mostly-diagonal sweep

  return (
    <div style={{ position: "relative", width: "100%", height: height ?? "100%", overflow: "hidden" }} aria-hidden>
      <svg width="100%" height="100%" viewBox="0 0 600 200" preserveAspectRatio="none"
        style={{ display: "block" }} role="presentation">
        <defs>
          <linearGradient id={`bn-${seed}`} gradientTransform={`rotate(${angle} .5 .5)`}>
            <stop offset="0%"   stopColor={`oklch(64% .20 ${hue})`} />
            <stop offset="100%" stopColor={`oklch(44% .19 ${hue2})`} />
          </linearGradient>
          <radialGradient id={`bn-${seed}-a`} cx={`${20 + (h % 40)}%`} cy="10%" r="80%">
            <stop offset="0%"   stopColor={`oklch(78% .15 ${(hue + 20) % 360})`} stopOpacity=".7" />
            <stop offset="100%" stopColor={`oklch(78% .15 ${(hue + 20) % 360})`} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`bn-${seed}-b`} cx="85%" cy="92%" r="70%">
            <stop offset="0%"   stopColor="#fff" stopOpacity=".22" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="600" height="200" fill={`url(#bn-${seed})`} />
        <rect width="600" height="200" fill={`url(#bn-${seed}-a)`} />
        <rect width="600" height="200" fill={`url(#bn-${seed}-b)`} />
      </svg>

      {avatar && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatar} alt="" aria-hidden="true" style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", transform: "scale(1.35)",
            filter: "blur(30px) saturate(1.3)", opacity: 0.22,
          }} />
          {/* pulls whatever colour the avatar brought back toward the brand */}
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(${90 + angle}deg,
              oklch(60% .20 ${hue} / .48), oklch(42% .19 ${hue2} / .36))`,
          }} />
        </>
      )}
    </div>
  );
}
