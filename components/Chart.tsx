"use client";
import { useMemo } from "react";

export interface Point { t: string; pnl: number }

/**
 * Area chart over a PnL series. The dashed rule sits at the first value in
 * the range, so the shape reads as "up or down since then" - the same
 * question the market asks.
 */
export default function Chart({
  points, w = 320, h = 90, showBaseline = true, showAxis = false, strokeWidth = 1.9,
}: {
  points: Point[]; w?: number; h?: number;
  showBaseline?: boolean; showAxis?: boolean; strokeWidth?: number;
}) {
  const g = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.pnl);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.12 || Math.abs(max) * 0.05 || 1;
    const lo = min - pad, hi = max + pad;
    const x = (i: number) => (i / (points.length - 1)) * w;
    const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;

    let d = "";
    for (let i = 0; i < points.length; i++) d += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`;
    return {
      line: d, area: `${d} L${w},${h} L0,${h} Z`,
      base: y(vals[0]), rising: vals[vals.length - 1] >= vals[0],
      lo, hi, first: vals[0], last: vals[vals.length - 1], min, max,
    };
  }, [points, w, h]);

  if (!g) return <div style={{ height: h }} />;

  const c = g.rising ? "var(--up)" : "var(--down)";
  const id = `ch${Math.abs(Math.round(g.first))}-${points.length}-${w}`;
  const fmt = (v: number) => {
    const a = Math.abs(v);
    const s = v < 0 ? "-$" : "$";
    if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
    return `${s}${a.toFixed(0)}`;
  };

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity=".26" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>

      {showBaseline && (
        <line x1="0" y1={g.base} x2={w} y2={g.base}
          stroke="var(--fg-faint)" strokeWidth="1" strokeDasharray="3 4" opacity=".45"
          vectorEffect="non-scaling-stroke" />
      )}

      <path className="spark-area" d={g.area} fill={`url(#${id})`} />
      <path className="spark-line" d={g.line} fill="none" stroke={c}
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" style={{ ["--len" as any]: `${w * 3}px` }} />

      {showAxis && (
        <>
          <text x={w - 2} y="11" textAnchor="end" fontSize="9" fill="var(--fg-faint)"
            style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(g.max)}</text>
          <text x={w - 2} y={h - 3} textAnchor="end" fontSize="9" fill="var(--fg-faint)"
            style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(g.min)}</text>
        </>
      )}
    </svg>
  );
}
