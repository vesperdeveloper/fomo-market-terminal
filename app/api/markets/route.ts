import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";
import { readMarkets } from "@/lib/onchain";
import { impliedPrice, multiple } from "@/lib/pool";
import { QUOTE_STAKE } from "@/lib/view";
import { valueAt } from "@/lib/settlement";
import { marketAddress, chain } from "@/lib/chain";

export const dynamic = "force-dynamic";

/** The book, straight off the contract, with the record's view of the
 *  underlying next to it. Public because a settlement anybody can check
 *  needs inputs anybody can fetch. */
export async function GET(req: Request) {
  const { store, snaps } = await ready();
  const url = new URL(req.url);
  const handle = url.searchParams.get("handle");

  const [markets, traders] = await Promise.all([readMarkets(), store.getTraders()]);
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
        price: { call: impliedPrice(m.pools, "call"), put: impliedPrice(m.pools, "put") },
        multiple: {
          call: multiple(m.pools, "call", QUOTE_STAKE),
          put: multiple(m.pools, "put", QUOTE_STAKE),
        },
        quoteStake: QUOTE_STAKE,
      };
    })
    .sort((a, b) => a.id - b.id);

  return NextResponse.json({
    chainId: chain.id,
    contract: marketAddress(),
    count: rows.length,
    markets: rows,
  });
}
