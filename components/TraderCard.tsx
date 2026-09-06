"use client";
import Link from "next/link";
import { useState } from "react";
import Chart, { type Point } from "./Chart";
import Banner from "./Banner";
import RangeTabs, { type Range } from "./RangeTabs";
import { usd, usdShort, pct, signed, followers as fmtF, initials } from "@/lib/format";
import { fullSize } from "@/lib/img";

export interface CardMarket {
  id: number; window: "24h" | "7d";
  multiple: { call: number; put: number };
  price: { call: number; put: number };
  volume: number;
}
export interface CardTrader {
  handle: string; name: string; bio?: string;
  followers: number; avatar?: string; banner?: string;
}
export interface CardHistory { "24h": Point[]; "7d": Point[]; "30d": Point[]; all: Point[] }

/**
 * Headline move for a range. A ratio is only shown when the starting value
 * is large enough to carry one; on a series that begins near zero the
 * percentage is meaningless, so the dollar move is shown instead.
 */
function headline(pts: Point[]): { text: string; up: boolean } {
  if (pts.length < 2) return { text: "—", up: true };
  const a = pts[0].pnl, b = pts[pts.length - 1].pnl;
  const d = b - a;
  const usable = Math.abs(a) > Math.abs(d) * 0.1 && Math.abs(a) > 1000;
  return { text: usable ? pct(d / Math.abs(a)) : signed(d), up: d >= 0 };
}

/**
 * The one component the product is built from: a profile, the account's
 * money line under it, the stats that price it, and - where a profile would
 * carry a follow button - the two sides of a live market.
 */
export default function TraderCard({
  trader, pnl, history, market, stats, compact, defaultRange = "24h", rank,
}: {
  trader: CardTrader; pnl: number; history: CardHistory;
  market?: CardMarket;
  stats?: { vol: number; winRate: number; volume30d: number };
  compact?: boolean; defaultRange?: Range; rank?: number;
}) {
  const [range, setRange] = useState<Range>(defaultRange);
  const pts = history[range] ?? [];
  const { text: headlineText, up } = headline(pts);

  return (
    <article className="lift" style={{
      background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
      borderRadius: "var(--r-xl)", overflow: "hidden", display: "flex", flexDirection: "column",
    }}>
      {/* The banner is what makes a card read as somebody's card, so the
          compact variant keeps it and only loses height. */}
      <div style={{ position: "relative", height: compact ? 58 : 78, overflow: "hidden" }}>
        {trader.banner
          ? <div style={{ height: "100%", width: "100%", background: `center/cover url(${trader.banner})` }} />
          : <Banner handle={trader.handle} height={compact ? 58 : 78}
              avatar={trader.avatar ? fullSize(trader.avatar) : undefined} />}
        {rank != null && (
          <div style={{
            position: "absolute", top: 8, right: 8,
            width: 28, height: 28, borderRadius: "50%",
            background: "var(--accent)", color: "#fff",
            display: "grid", placeItems: "center",
            fontWeight: 600, fontSize: 12, lineHeight: 1,
          }}>#{rank}</div>
        )}
      </div>

      {/* Only the avatar laps onto the banner. Pulling the whole block up
          put the name and handle on top of the artwork, where they were
          unreadable and looked like a layout fault. */}
      <div style={{ padding: "0 var(--s-4)", position: "relative", zIndex: 1 }}>
        <div style={{ marginTop: compact ? -20 : -26 }}>
          <Avatar trader={trader} size={compact ? 42 : 54} ring />
        </div>
        <div style={{ marginTop: "var(--s-2)", minWidth: 0 }}>
          <Link href={`/t/${trader.handle}`} style={{
            display: "flex", alignItems: "center", gap: 5,
            fontFamily: "var(--font-display)", fontWeight: 600,
            fontSize: "1.0625rem", letterSpacing: "-.02em",
          }}>
            {trader.name}<Verified />
          </Link>
          <div style={{ fontSize: ".8125rem", color: "var(--fg-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            @{trader.handle} · <strong style={{ color: "var(--fg-muted)" }}>{fmtF(trader.followers)}</strong> followers
          </div>
        </div>

        {trader.bio && !compact && (
          <p style={{
            margin: "var(--s-3) 0 0", fontSize: ".8125rem", color: "var(--fg-muted)",
            lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{trader.bio}</p>
        )}
      </div>

      <div style={{ padding: "var(--s-4)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="eyebrow">PnL · {range}</span>
          <span className="num" style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>{usdShort(pnl)}</span>
        </div>
        <div className="num" style={{
          fontFamily: "var(--font-display)", fontSize: "1.75rem", fontWeight: 600,
          letterSpacing: "-.03em", color: up ? "var(--up)" : "var(--down)", marginTop: 1,
        }}>{headlineText}</div>

        <div style={{ marginTop: "var(--s-2)" }}>
          <Chart points={pts} w={300} h={compact ? 54 : 78} />
        </div>

        <div style={{ marginTop: "var(--s-3)" }}>
          <RangeTabs value={range} onChange={setRange} tone={up ? "up" : "down"} />
        </div>

        {stats && (
          <dl style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-3) var(--s-4)",
            margin: "var(--s-4) 0 0", paddingTop: "var(--s-4)",
            borderTop: "1px solid var(--border-subtle)", fontSize: ".8125rem",
          }}>
            <Stat k="Index" v={usd(pnl, 0)} />
            <Stat k="Vol (σ)" v={usdShort(stats.vol)} right />
            <Stat k="Win rate" v={`${Math.round(stats.winRate * 100)}%`} />
            <Stat k="Volume 30d" v={usdShort(stats.volume30d)} right />
          </dl>
        )}
      </div>

      {market && (
        <div style={{ marginTop: "auto", padding: "0 var(--s-4) var(--s-4)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-2)" }}>
            <SideButton side="call" m={market} />
            <SideButton side="put" m={market} />
          </div>
          <div style={{
            display: "flex", justifyContent: "space-between", gap: "var(--s-2)",
            marginTop: "var(--s-3)", paddingTop: "var(--s-3)",
            borderTop: "1px solid var(--border-subtle)",
            fontSize: ".8125rem", color: "var(--fg-faint)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <i className="live-dot" style={{ width: 6, height: 6, borderRadius: 9, background: "var(--up)", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Is @{trader.handle} up over the next {market.window === "24h" ? "24 hours" : "7 days"}?
              </span>
            </span>
            <span className="num" style={{ whiteSpace: "nowrap" }}>{usdShort(market.volume)} vol</span>
          </div>
        </div>
      )}
    </article>
  );
}

function Stat({ k, v, right }: { k: string; v: string; right?: boolean }) {
  return (
    <div style={{ textAlign: right ? "right" : "left" }}>
      <dt style={{ color: "var(--fg-faint)" }}>{k}</dt>
      <dd className="num" style={{ margin: "2px 0 0", fontWeight: 600, fontSize: ".9375rem" }}>{v}</dd>
    </div>
  );
}

export function Verified() {
  return (
    <svg width="15" height="15" viewBox="0 0 22 22" aria-label="verified" style={{ flexShrink: 0 }}>
      <path fill="var(--accent)" d="M11 1.5l2.2 1.9 2.9-.3 1.2 2.7 2.6 1.4-.7 2.8.7 2.8-2.6 1.4-1.2 2.7-2.9-.3L11 20.5l-2.2-1.9-2.9.3-1.2-2.7L2.1 14.8l.7-2.8-.7-2.8 2.6-1.4 1.2-2.7 2.9.3z"/>
      <path fill="var(--surface-raised)" d="M9.8 14.3l-3-3 1.2-1.2 1.8 1.8 4.2-4.2 1.2 1.2z"/>
    </svg>
  );
}

export function Avatar({ trader, size = 44, ring }: { trader: CardTrader; size?: number; ring?: boolean }) {
  const common: React.CSSProperties = {
    width: size, height: size, borderRadius: "var(--r-full)", flexShrink: 0,
    border: ring ? "3px solid var(--surface-raised)" : "1px solid var(--border-subtle)",
    boxShadow: ring ? "var(--shadow-2)" : "none",
  };
  if (trader.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fullSize(trader.avatar)} alt="" style={{ ...common, objectFit: "cover" }} />;
  }
  return (
    <div style={{
      ...common, display: "grid", placeItems: "center",
      background: "var(--accent-quiet)", color: "var(--accent)",
      fontWeight: 700, fontSize: size * 0.34, fontFamily: "var(--font-display)",
    }}>{initials(trader.name || trader.handle)}</div>
  );
}

function SideButton({ side, m }: { side: "call" | "put"; m: CardMarket }) {
  const isCall = side === "call";
  return (
    <Link href={`/m/${m.id}?side=${side}`} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      padding: "11px 10px", borderRadius: "var(--r-md)",
      background: isCall ? "var(--up-quiet)" : "var(--down-quiet)",
      color: isCall ? "var(--up)" : "var(--down)",
      fontWeight: 600, fontSize: ".9375rem",
      transition: "filter var(--dur-micro) var(--ease-ui)",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(.97)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}>
      <span>{isCall ? "↑" : "↓"}</span>
      <span>{isCall ? "Call" : "Put"}</span>
      <span className="num" style={{ opacity: .72 }}>{m.multiple[side].toFixed(2)}x</span>
    </Link>
  );
}
