import { board, multipleOf, priceOf } from "@/lib/view";
import DiscoverBoard from "@/components/DiscoverBoard";

export const dynamic = "force-dynamic";

export default async function Discover() {
  const { rows, readAt, source } = await board();

  // Pre-compute price and multiple maps on the server so the client component
  // receives plain serialisable data and the AMM helpers stay server-only.
  const priceMap: Record<number, { call: number; put: number }> = {};
  const multipleMap: Record<number, { call: number; put: number }> = {};
  for (const r of rows) {
    for (const m of r.markets) {
      priceMap[m.id] = { call: priceOf(m, "call"), put: priceOf(m, "put") };
      multipleMap[m.id] = { call: multipleOf(m, "call"), put: multipleOf(m, "put") };
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: "var(--s-10)", paddingBottom: "var(--section-y)" }}>
      <div className="eyebrow">Markets</div>
      <h1 style={{ fontSize: "var(--step-4)", marginTop: "var(--s-3)", letterSpacing: "-.045em" }}>Every trader, every market</h1>
      <p style={{ color: "var(--fg-muted)", maxWidth: "56ch", marginTop: "var(--s-3)", lineHeight: 1.6 }}>
        Up or down on whether a fomo trader&apos;s total account PnL ends the window
        ahead of where it started — over the next 24 hours, and over the next 7 days.
      </p>
      {readAt && (
        <p className="num" style={{ fontSize: ".8125rem", color: "var(--fg-faint)", marginTop: "var(--s-3)" }}>
          Last read {new Date(readAt).toISOString().replace("T", " ").slice(0, 16)}Z · {source}
        </p>
      )}

      <DiscoverBoard
        rows={rows.map((r) => ({
          trader: r.trader,
          pnl: r.pnl,
          history: r.history,
          delta24h: r.delta24h,
          delta7d: r.delta7d,
          change24h: r.change24h,
          change7d: r.change7d,
          stats: r.stats,
          markets: r.markets,
        }))}
        priceMap={priceMap}
        multipleMap={multipleMap}
      />
    </div>
  );
}
