"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import TraderCard, { Avatar, Verified } from "./TraderCard";
import Sparkline from "./Sparkline";
import Reveal from "./Reveal";
import type { CardMarket } from "./TraderCard";
import { usdShort, moveLabel, followers as fmtF } from "@/lib/format";

type SortKey = "pnl" | "24h" | "7d" | "followers" | "volume";
type View = "list" | "cards";

interface RowData {
  trader: { handle: string; name: string; bio?: string; followers: number; avatar?: string; banner?: string };
  pnl: number;
  history: { "24h": any[]; "7d": any[]; "30d": any[]; all: any[] };
  delta24h: number;
  delta7d: number;
  change24h: number;
  change7d: number;
  hasRecord: boolean;
  stats: { vol: number; winRate: number; volume30d: number };
  markets: { id: number; window: string; volume: number; status?: string; reserves?: any }[];
}

interface Props {
  rows: RowData[];
  priceMap: Record<number, { call: number; put: number }>;
  multipleMap: Record<number, { call: number; put: number }>;
}

const TABS: { key: SortKey; label: string }[] = [
  { key: "pnl", label: "Verified" },
  { key: "24h", label: "Gainers" },
  { key: "7d", label: "Trending" },
  { key: "followers", label: "Most followed" },
  { key: "volume", label: "Most traded" },
];

export default function DiscoverBoard({ rows, priceMap, multipleMap }: Props) {
  const [sort, setSort] = useState<SortKey>("pnl");
  const [view, setView] = useState<View>("list");
  const [q, setQ] = useState("");

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const copy = rows.filter(
      (r) =>
        !needle ||
        r.trader.handle.toLowerCase().includes(needle) ||
        r.trader.name.toLowerCase().includes(needle),
    );
    switch (sort) {
      case "pnl": copy.sort((a, b) => b.pnl - a.pnl); break;
      case "24h": copy.sort((a, b) => b.delta24h - a.delta24h); break;
      case "7d": copy.sort((a, b) => b.delta7d - a.delta7d); break;
      case "followers": copy.sort((a, b) => b.trader.followers - a.trader.followers); break;
      case "volume": copy.sort((a, b) => b.stats.volume30d - a.stats.volume30d); break;
    }
    return copy;
  }, [rows, sort, q]);

  const traderCount = new Set(rows.map((r) => r.trader.handle)).size;
  const marketCount = rows.reduce((s, r) => s + r.markets.length, 0);

  return (
    <>
      {/* search — the app puts one across the top of every board */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10, marginTop: "var(--s-6)",
          padding: "10px 14px", borderRadius: "var(--r-md)",
          background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
        }}
      >
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search for a trader or handle…"
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            color: "var(--fg)", fontSize: ".9375rem", minWidth: 0,
          }}
        />
        <span
          style={{
            fontSize: ".6875rem", color: "var(--fg-faint)", padding: "3px 7px",
            borderRadius: 5, border: "1px solid var(--border-subtle)",
          }}
        >
          {sorted.length} listed
        </span>
      </div>

      {/* filter chips + view switch, the row fomo runs under its search */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "var(--s-4)", alignItems: "center" }}>
        {TABS.map((tab) => {
          const on = sort === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSort(tab.key)}
              style={{
                padding: "7px 14px", borderRadius: "var(--r-md)", cursor: "pointer",
                fontWeight: 500, fontSize: ".875rem", fontFamily: "inherit",
                transition: "background var(--dur-micro), color var(--dur-micro)",
                background: on ? "rgba(255,255,255,.1)" : "transparent",
                border: `1px solid ${on ? "var(--border-strong)" : "transparent"}`,
                color: on ? "var(--fg)" : "var(--fg-muted)",
              }}
            >
              {tab.label}
            </button>
          );
        })}

        <div
          style={{
            marginLeft: "auto", display: "flex", gap: 2, padding: 3,
            borderRadius: "var(--r-md)", background: "var(--surface-raised)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {(["list", "cards"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-label={v === "list" ? "List view" : "Card view"}
              style={{
                width: 30, height: 26, display: "grid", placeItems: "center", cursor: "pointer",
                borderRadius: 7, border: "none",
                background: view === v ? "rgba(255,255,255,.1)" : "transparent",
                color: view === v ? "var(--fg)" : "var(--fg-faint)",
              }}
            >
              {v === "list" ? <ListIcon /> : <GridIcon />}
            </button>
          ))}
        </div>
      </div>

      <p style={{ fontSize: ".875rem", color: "var(--fg-muted)", marginTop: "var(--s-4)", lineHeight: 1.6 }}>
        {marketCount
          ? `${marketCount} markets across ${traderCount} listed traders, one on the next 24 hours and one on the next 7 days.`
          : `${traderCount} accounts listed. Each carries a 24-hour and a 7-day market the moment the book opens.`}
      </p>

      {view === "list" ? (
        <div
          className="panel"
          style={{ marginTop: "var(--s-4)", overflow: "hidden" }}
        >
          {sorted.map((r, i) => {
            // an open market first: a row that lands on a voided one is a dead end
            const m24 =
              r.markets.find((m) => m.status === "open" && m.window === "24h") ??
              r.markets.find((m) => m.status === "open") ??
              r.markets.find((m) => m.window === "24h") ??
              r.markets[0];
            const mult = m24 ? multipleMap[m24.id] : undefined;
            const pts = r.history["24h"]?.length ? r.history["24h"] : r.history.all;
            const up = r.delta24h >= 0;
            const moved = moveLabel({ pnl: r.pnl, delta: r.delta24h, change: r.change24h, hasRecord: r.hasRecord });
            return (
              <Link
                key={r.trader.handle}
                href={m24 ? `/m/${m24.id}` : `/t/${r.trader.handle}`}
                className="row-hit board-row"
                style={{
                  borderBottom: i === sorted.length - 1 ? "none" : "1px solid var(--border-subtle)",
                }}
              >
                <span className="num list-rank" style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>{i + 1}</span>
                <Avatar trader={r.trader} size={38} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 500, lineHeight: 1.25 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.trader.name}</span>
                    <Verified />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span
                      style={{
                        fontSize: ".625rem", color: "var(--fg-faint)", padding: "1px 5px",
                        borderRadius: 4, border: "1px solid var(--border-subtle)",
                      }}
                    >
                      PNL
                    </span>
                    <span className="num" style={{ fontSize: ".8125rem", color: "var(--fg-muted)" }}>
                      {usdShort(r.pnl)}
                    </span>
                    <span style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>· {fmtF(r.trader.followers)}</span>
                  </span>
                </span>

                <span className="list-spark" style={{ opacity: .9 }}>
                  <Sparkline values={pts.map((x: any) => x.pnl)} w={90} h={30} up={up} />
                </span>

                <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className="num" style={{ display: "block", fontWeight: 500 }}>{usdShort(r.pnl)}</span>
                  {moved === null ? (
                    <span className="num" title="not enough readings on this account yet"
                      style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>—</span>
                  ) : (
                    <span className="num" style={{ fontSize: ".8125rem", color: up ? "var(--up)" : "var(--down)" }}>
                      {up ? "▲" : "▼"} {moved.replace("+", "").replace("−", "")}
                    </span>
                  )}
                </span>

                <span className="list-quotes" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {mult && (
                    <>
                      <Quote tone="up" v={mult.call} />
                      <Quote tone="down" v={mult.put} />
                    </>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "grid", gap: "var(--s-5)", marginTop: "var(--s-4)",
            gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
          }}
        >
          {sorted.flatMap((r, ri) =>
            r.markets.map((m, mi) => {
              const market: CardMarket = {
                id: m.id,
                window: m.window as "24h" | "7d",
                volume: m.volume,
                price: priceMap[m.id] ?? { call: 0.5, put: 0.5 },
                multiple: multipleMap[m.id] ?? { call: 1, put: 1 },
              };
              return (
                <Reveal key={m.id} delay={mi * 40}>
                  <TraderCard
                    trader={r.trader}
                    pnl={r.pnl}
                    history={r.history}
                    stats={r.stats}
                    defaultRange={m.window === "7d" ? "7d" : "24h"}
                    market={market}
                    rank={ri + 1}
                  />
                </Reveal>
              );
            }),
          )}
        </div>
      )}

    </>
  );
}

function Quote({ tone, v }: { tone: "up" | "down"; v: number }) {
  return (
    <span
      className="num"
      style={{
        padding: "6px 10px", borderRadius: "var(--r-sm)", fontSize: ".8125rem", fontWeight: 500,
        background: `var(--${tone}-quiet)`, color: `var(--${tone})`, whiteSpace: "nowrap",
      }}
    >
      {tone === "up" ? "↑" : "↓"} {v.toFixed(2)}x
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-faint)" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}
