import Link from "next/link";
import { board, multipleOf } from "@/lib/view";
import { Avatar } from "@/components/TraderCard";
import Reveal from "@/components/Reveal";
import { usdShort, pct, followers as fmtF, moveLabel } from "@/lib/format";

/* Rendered once and reused for 60s — ranks follow the reading, not the trading.
   Every click used to be a full server render against the database, which
   is what made the site feel slow to answer. */
export const revalidate = 60;

export default async function Leaderboard() {
  const { rows, readAt, source } = await board();

  return (
    <div className="wrap" style={{ paddingTop: "var(--s-12)", paddingBottom: "var(--section-y)" }}>
      <div className="eyebrow">Leaderboard</div>
      <h1 style={{ fontSize: "var(--step-4)", marginTop: "var(--s-3)" }}>Who is actually up</h1>
      <p style={{ color: "var(--fg-muted)", maxWidth: "60ch", marginTop: "var(--s-3)", lineHeight: 1.6 }}>
        Ranked by cumulative account PnL. The windowed figures are measured from
        the same published readings, under the same median rule, that settle the
        markets — so what you see here is what a settlement would use.
      </p>
      {readAt && (
        <p className="num" style={{ fontSize: ".8125rem", color: "var(--fg-faint)", marginTop: "var(--s-3)" }}>
          Read {new Date(readAt).toISOString().replace("T", " ").slice(0, 16)}Z · {source}
        </p>
      )}

      <div style={{ display: "grid", gap: "var(--s-3)", marginTop: "var(--s-8)" }}>
        {rows.map((r, i) => {
          const m = r.markets.find((x) => x.window === "24h") ?? r.markets[0];
          return (
            <Reveal key={r.trader.handle} delay={i * 35}>
              <div className="lift" style={{
                display: "grid", alignItems: "center", gap: "var(--s-4)",
                gridTemplateColumns: "36px minmax(0,2fr) repeat(2, minmax(0,1fr)) auto",
                padding: "var(--s-4)", borderRadius: "var(--r-lg)",
                background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
              }} >
                <span className="num" style={{ color: "var(--fg-faint)", fontWeight: 600 }}>#{i + 1}</span>
                <Link href={`/t/${r.trader.handle}`} style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", minWidth: 0 }}>
                  <Avatar trader={r.trader} size={40} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, display: "block" }}>{r.trader.name}</span>
                    <span style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>
                      @{r.trader.handle} · {fmtF(r.trader.followers)}
                    </span>
                  </span>
                </Link>
                <span>
                  <span className="eyebrow" style={{ display: "block" }}>Total PnL</span>
                  <span className="num" style={{ fontWeight: 600 }}>{usdShort(r.pnl)}</span>
                </span>
                <span>
                  <span className="eyebrow" style={{ display: "block" }}>24h</span>
                  <span className="num" style={{
                    fontWeight: 600,
                    color: !r.hasRecord ? "var(--fg-faint)" : r.change24h >= 0 ? "var(--up)" : "var(--down)",
                  }}>
                    {moveLabel({ pnl: r.pnl, delta: r.delta24h, change: r.change24h, hasRecord: r.hasRecord }) ?? "—"}
                  </span>
                </span>
                {m && (
                  <span style={{ display: "flex", gap: 8 }}>
                    <Pill kind="call" v={multipleOf(m, "call")} href={`/m/${m.id}?side=call`} />
                    <Pill kind="put" v={multipleOf(m, "put")} href={`/m/${m.id}?side=put`} />
                  </span>
                )}
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ kind, v, href }: { kind: "call" | "put"; v: number; href: string }) {
  const isCall = kind === "call";
  return (
    <Link href={href} className="num" style={{
      padding: "8px 13px", borderRadius: "var(--r-sm)", fontSize: ".8125rem", fontWeight: 500,
      background: isCall ? "var(--up-quiet)" : "var(--down-quiet)",
      color: isCall ? "var(--up)" : "var(--down)", whiteSpace: "nowrap",
    }}>{isCall ? "↑ Call" : "↓ Put"} {v.toFixed(2)}x</Link>
  );
}
