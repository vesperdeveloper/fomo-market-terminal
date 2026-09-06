"use client";

/** Area + line chart for a PnL series. The line draws itself once on
 *  mount; the fill fades in behind it. */
export default function Sparkline({
  values, w = 320, h = 84, up,
}: { values: number[]; w?: number; h?: number; up?: boolean }) {
  if (values.length < 2) return <svg width={w} height={h} />;

  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 6) - 3;

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const rising = up ?? values[values.length - 1] >= values[0];
  const c = rising ? "var(--up)" : "var(--down)";
  const id = `g${Math.round(min * 1e4)}${values.length}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity=".22" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="spark-area" d={area} fill={`url(#${id})`} />
      <path className="spark-line" d={line} fill="none" stroke={c} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ ["--len" as any]: `${w * 2.2}px` }} />
    </svg>
  );
}
