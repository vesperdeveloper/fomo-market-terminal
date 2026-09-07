import { notFound } from "next/navigation";
import { ready } from "@/lib/runtime";
import { board } from "@/lib/view";
import Ticket from "@/components/Ticket";
import MarketRail, { type RailRow } from "@/components/MarketRail";

/* Rendered once and reused for 20s — the ticket re-reads the book itself after a fill; this is the shell.
   Every click used to be a full server render against the database, which
   is what made the site feel slow to answer. */
export const revalidate = 20;

export default async function MarketPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const { id } = await params;
  const { side } = await searchParams;
  const { store } = await ready();

  const market = (await store.getMarkets()).find((m) => m.id === Number(id));
  if (!market) notFound();

  const { rows } = await board();
  const row = rows.find((r) => r.trader.handle === market.handle);
  if (!row) notFound();

  // the rail carries one entry per account, pointed at a market of the same
  // window as the one being viewed so switching accounts keeps the horizon
  const rail: RailRow[] = rows.map((r) => {
    const m =
      r.markets.find((x) => x.status === "open" && x.window === market.window) ??
      r.markets.find((x) => x.status === "open") ??
      r.markets[0];
    return {
      handle: r.trader.handle,
      name: r.trader.name,
      avatar: r.trader.avatar,
      followers: r.trader.followers,
      pnl: r.pnl,
      delta24h: r.delta24h,
      change24h: r.change24h,
      hasRecord: r.hasRecord,
      marketId: m?.id ?? null,
      window: m?.window ?? null,
    };
  });

  return (
    <div className="wrap-wide" style={{ paddingTop: "var(--s-8)", paddingBottom: "var(--section-y)" }}>
      <div
        style={{
          display: "grid", gap: "var(--s-5)", alignItems: "start",
          gridTemplateColumns: "272px minmax(0, 1fr)",
        }}
        className="market-shell"
      >
        <MarketRail rows={rail} activeId={market.id} />
        <div style={{ minWidth: 0 }}>
          <Ticket
            market={JSON.parse(JSON.stringify(market))}
            trader={row.trader}
            history={row.history}
            initialSide={side === "put" ? "put" : "call"}
          />
        </div>
      </div>
      <style>{`
        @media (max-width: 1180px){
          .market-shell{grid-template-columns:1fr !important}
          .market-rail{display:none !important}
        }
      `}</style>
    </div>
  );
}
