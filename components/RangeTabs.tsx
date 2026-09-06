"use client";

export type Range = "24h" | "7d" | "30d" | "all";
export const RANGES: Range[] = ["24h", "7d", "30d", "all"];

export default function RangeTabs({
  value, onChange, tone = "accent",
}: { value: Range; onChange: (r: Range) => void; tone?: "accent" | "up" | "down" }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {RANGES.map((r) => {
        const on = r === value;
        return (
          // fomo runs its timeframes as neutral chips and lets the series
          // carry the colour, so the tone only tints the active label
          <button key={r} onClick={() => onChange(r)} className="num" style={{
            padding: "5px 10px", borderRadius: "var(--r-sm)", cursor: "pointer",
            border: "none", fontFamily: "inherit", fontSize: ".75rem", fontWeight: 500,
            letterSpacing: ".03em", textTransform: "uppercase",
            background: on ? "rgba(255,255,255,.1)" : "transparent",
            color: on ? (tone === "accent" ? "var(--fg)" : `var(--${tone})`) : "var(--fg-faint)",
            transition: "background var(--dur-micro) var(--ease-ui), color var(--dur-micro) var(--ease-ui)",
          }}>{r}</button>
        );
      })}
    </div>
  );
}
