"use client";
import { useState } from "react";
import Chart, { type Point } from "./Chart";
import RangeTabs, { type Range } from "./RangeTabs";
import { usdShort, pct, signed } from "@/lib/format";

export default function TraderChartPanel({
  history, pnl,
}: { history: { "24h": Point[]; "7d": Point[]; "30d": Point[]; all: Point[] }; pnl: number }) {
  const [range, setRange] = useState<Range>("7d");
  const pts = history[range] ?? [];
  // same guard the cards use: a ratio only where the base can carry one
  const a = pts.length > 1 ? pts[0].pnl : 0;
  const d = pts.length > 1 ? pts[pts.length - 1].pnl - a : 0;
  const usable = Math.abs(a) > Math.abs(d) * 0.1 && Math.abs(a) > 1000;
  const headline = pts.length > 1 ? (usable ? pct(d / Math.abs(a)) : signed(d)) : "—";
  const up = d >= 0;

  return (
    <div style={{
      marginTop: "var(--s-8)", padding: "var(--s-6)", borderRadius: "var(--r-xl)",
      background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
      boxShadow: "var(--shadow-2)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--s-4)", flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">Cumulative PnL · {range}</span>
          <div className="num" style={{
            fontFamily: "var(--font-display)", fontSize: "1.75rem", fontWeight: 600,
            letterSpacing: "-.03em", marginTop: 4,
          }}>
            {usdShort(pnl)}{" "}
            <span style={{ fontSize: "1rem", color: up ? "var(--up)" : "var(--down)" }}>{headline}</span>
          </div>
        </div>
        <RangeTabs value={range} onChange={setRange} tone={up ? "up" : "down"} />
      </div>

      <div style={{ marginTop: "var(--s-5)" }}>
        <Chart points={pts} w={1100} h={260} showAxis strokeWidth={2} />
      </div>

      <p style={{ margin: "var(--s-4) 0 0", fontSize: ".8125rem", color: "var(--fg-faint)" }}>
        {pts.length} readings. The same record settles the markets below.
      </p>
    </div>
  );
}
