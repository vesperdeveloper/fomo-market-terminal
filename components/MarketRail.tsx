import Link from "next/link";
import { Avatar } from "./TraderCard";
import { usdShort, moveLabel } from "@/lib/format";

export interface RailRow {
  handle: string;
  name: string;
  avatar?: string;
  followers: number;
  pnl: number;
  delta24h: number;
  change24h: number;
  hasRecord: boolean;
  marketId: number | null;
  window: string | null;
}

/**
 * The left rail off the fomo app: the whole board sitting beside whatever you
 * are looking at, so switching accounts never costs a trip back to a list.
 * Rendered on the server — it is the same data the board page already read.
 */
export default function MarketRail({ rows, activeId }: { rows: RailRow[]; activeId: number }) {
  return (
    <aside
      className="panel market-rail"
      style={{ overflow: "hidden", position: "sticky", top: "calc(var(--nav-h) + 16px)" }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px var(--s-4)", borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ fontWeight: 500, fontSize: ".9375rem" }}>Accounts</span>
        <Link href="/discover" style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>
          All markets
        </Link>
      </div>

      <div style={{ maxHeight: "calc(100vh - var(--nav-h) - 120px)", overflowY: "auto" }}>
        {rows.map((r) => {
          const on = r.marketId === activeId;
          const up = r.delta24h >= 0;
          const moved = moveLabel({ pnl: r.pnl, delta: r.delta24h, change: r.change24h, hasRecord: r.hasRecord });
          return (
            <Link
              key={r.handle}
              href={r.marketId ? `/m/${r.marketId}` : `/t/${r.handle}`}
              className="row-hit"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px var(--s-4)",
                borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                background: on ? "var(--surface-hover)" : "transparent",
              }}
            >
              <Avatar trader={r as any} size={32} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: "block", fontWeight: 500, fontSize: ".875rem", lineHeight: 1.25,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </span>
                <span className="num" style={{ fontSize: ".75rem", color: "var(--fg-faint)" }}>
                  {usdShort(r.pnl)}
                </span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span
                  className="num"
                  style={{
                    display: "block", fontSize: ".8125rem",
                    color: moved === null ? "var(--fg-faint)" : up ? "var(--up)" : "var(--down)",
                  }}
                >
                  {moved === null ? "—" : `${up ? "▲" : "▼"} ${moved.replace("+", "").replace("−", "")}`}
                </span>
                {r.window && (
                  <span style={{ fontSize: ".6875rem", color: "var(--fg-faint)" }}>{r.window}</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
