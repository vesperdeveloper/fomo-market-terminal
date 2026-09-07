import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";
import { spotPrice, quoteBuy, QUOTE_STAKE } from "@/lib/amm";
import { netMultiple } from "@/lib/prior";
import { valueAt } from "@/lib/settlement";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { store, snaps } = await ready();
  const url = new URL(req.url);
  const handle = url.searchParams.get("handle");

  const markets = await store.getMarkets();
  const traders = await store.getTraders();
  const now = new Date().toISOString();

  const rows = markets
    .filter((m) => !handle || m.handle === handle)
    .map((m) => {
      const t = traders.find((x) => x.handle === m.handle);
      const live = valueAt(snaps, m.handle, now)?.value ?? null;
      return {
        ...m,
        trader: t ?? null,
        live,
        // price and implied probability are the same number here
        price: { call: spotPrice(m.reserves, "call"), put: spotPrice(m.reserves, "put") },
        // same reference ticket and same fee treatment the cards use, so a
        // market cannot quote one multiple here and another on its page
        multiple: {
          call: netMultiple(quoteBuy(m.reserves, "call", QUOTE_STAKE).shares, QUOTE_STAKE),
          put: netMultiple(quoteBuy(m.reserves, "put", QUOTE_STAKE).shares, QUOTE_STAKE),
        },
        quoteStake: QUOTE_STAKE,
      };
    })
    .sort((a, b) => a.id - b.id);

  return NextResponse.json({ count: rows.length, markets: rows });
}
