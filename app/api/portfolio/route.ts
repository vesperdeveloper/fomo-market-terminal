import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";
import { redeem, feeSplit } from "@/lib/settlement";
import { spotPrice } from "@/lib/amm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { store } = await ready();
  const owner = new URL(req.url).searchParams.get("owner");
  if (!owner) return NextResponse.json({ error: "owner required" }, { status: 400 });

  const [positions, markets, traders] = await Promise.all([
    store.getPositions(owner), store.getMarkets(), store.getTraders(),
  ]);

  const rows = positions
    .filter((p) => p.shares > 1e-9)
    .map((p) => {
      const m = markets.find((x) => x.id === p.marketId)!;
      const trader = traders.find((t) => t.handle === m.handle) ?? null;

      if (m.status === "settled") {
        const won = m.winner === p.side;
        const r = redeem(p.shares, p.cost, won);
        return { ...p, market: m, trader, state: won ? "won" : "lost", ...r,
                 split: won ? feeSplit(r.fee) : null };
      }
      if (m.status === "void") {
        // a void refunds at cost - the position never had a view to be wrong about
        return { ...p, market: m, trader, state: "void", net: p.cost, fee: 0 };
      }
      const mark = spotPrice(m.reserves, p.side);
      return { ...p, market: m, trader, state: "open",
               markPrice: mark, markValue: p.shares * mark };
    });

  const claimable = rows
    .filter((r) => (r.state === "won" || r.state === "void") && !r.claimedAt)
    .reduce((s, r: any) => s + (r.net ?? 0), 0);

  return NextResponse.json({ owner, positions: rows, claimable });
}

/** Claim settled winnings and refunds. */
export async function POST(req: Request) {
  const { store } = await ready();
  const { owner, id } = await req.json().catch(() => ({}));
  if (!owner || !id) return NextResponse.json({ error: "owner and id required" }, { status: 400 });

  const p = (await store.getPositions(owner)).find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: "no such position" }, { status: 404 });
  if (p.claimedAt) return NextResponse.json({ error: "already claimed" }, { status: 409 });

  const m = (await store.getMarkets()).find((x) => x.id === p.marketId)!;
  if (m.status === "open") return NextResponse.json({ error: "market still open" }, { status: 400 });

  const payout = m.status === "void"
    ? p.cost
    : redeem(p.shares, p.cost, m.winner === p.side).net;

  await store.putPosition({ ...p, claimedAt: new Date().toISOString(), payout });
  return NextResponse.json({ claimed: id, payout });
}
