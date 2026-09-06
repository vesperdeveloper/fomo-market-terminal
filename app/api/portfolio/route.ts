import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { ready } from "@/lib/runtime";
import { readMarkets, readPositions } from "@/lib/onchain";

export const dynamic = "force-dynamic";

/**
 * What a wallet is holding.
 *
 * Read from the contract rather than a table: there is no server-side record
 * of a position to drift out of step, and a position exists for exactly as
 * long as the chain says it does. Claiming is not here — that is a
 * transaction the holder signs, not something a server does on their behalf.
 */
export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get("owner");
  if (!owner) return NextResponse.json({ error: "owner required" }, { status: 400 });

  let address;
  try { address = getAddress(owner); }
  catch { return NextResponse.json({ error: "not an address" }, { status: 400 }); }

  const { store } = await ready();
  const [markets, traders] = await Promise.all([readMarkets(), store.getTraders()]);
  const positions = await readPositions(address, markets);

  const rows = positions.map((p) => {
    const m = markets.find((x) => x.id === p.marketId)!;
    const trader = traders.find((t) => t.handle === m.handle) ?? null;
    const state =
      m.status === "open" ? "open"
      : m.status === "void" ? "void"
      : m.winner === p.side ? "won" : "lost";
    return { ...p, market: m, trader, state };
  });

  const claimable = rows
    .filter((r) => !r.claimed && (r.state === "won" || r.state === "void"))
    .reduce((s, r) => s + (r.payout ?? 0), 0);

  return NextResponse.json({ owner: address, positions: rows, claimable });
}
