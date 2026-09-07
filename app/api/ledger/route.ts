import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";
import { redeem } from "@/lib/settlement";
import { treasuryBalance, treasuryGas, treasuryAddress, explorerTx } from "@/lib/chain";
import { worstCaseLiability, unbackedAllowed } from "@/lib/solvency";

export const dynamic = "force-dynamic";

/**
 * The operator's payout sheet.
 *
 * When the treasury cannot cover the book, settlement happens by hand, and
 * a hand needs a list: every wallet that is owed something, what it paid to
 * be owed it, and whether it has been paid. Guarded by the keeper secret
 * because it is a map of who holds money at this venue.
 */
export async function GET(req: Request) {
  const secret = process.env.KEEPER_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? new URL(req.url).searchParams.get("secret");
  if (!secret || given !== secret) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const { store } = await ready();
  const [markets, positions, collateral, gas] = await Promise.all([
    store.getMarkets(), store.getPositions(), treasuryBalance(), treasuryGas(),
  ]);

  const owed: {
    position: string; wallet: string; market: number; handle: string;
    side: string; shares: number; paid: number; owes: number;
    settledAt: string | null; depositTx: string | null;
  }[] = [];
  const paidOut: { position: string; wallet: string; amount: number; tx: string | null }[] = [];
  let takenIn = 0;

  for (const p of positions) {
    const m = markets.find((x) => x.id === p.marketId);
    if (p.depositTx) takenIn += p.cost;

    if (p.claimedAt) {
      if ((p.payout ?? 0) > 0) {
        paidOut.push({
          position: p.id, wallet: p.owner,
          amount: p.payout ?? 0, tx: p.payoutTx ?? null,
        });
      }
      continue;
    }
    if (!m) continue;

    const won = m.status === "settled" && m.winner === p.side;
    const amount = m.status === "void" ? p.cost : redeem(p.shares, p.cost, won).net;
    if (!(amount > 0)) continue;          // a losing ticket owes nothing

    owed.push({
      position: p.id, wallet: p.owner, market: m.id, handle: m.handle,
      side: p.side, shares: p.shares, paid: p.cost, owes: amount,
      settledAt: m.status === "settled" || m.status === "void" ? m.closesAt : null,
      depositTx: p.depositTx ?? null,
    });
  }

  // due now first: a settled market is money somebody is already waiting on
  owed.sort((a, b) =>
    (a.settledAt ? 0 : 1) - (b.settledAt ? 0 : 1) || b.owes - a.owes);

  const dueNow = owed.filter((o) => o.settledAt).reduce((s, o) => s + o.owes, 0);
  const worstCase = worstCaseLiability(markets, positions);

  return NextResponse.json({
    treasury: {
      address: treasuryAddress(), collateral, gas,
      canPay: gas > 0,
      unbacked: unbackedAllowed(),
    },
    money: {
      takenIn,
      dueNow,
      worstCase,
      shortfall: Math.max(0, worstCase - collateral),
      alreadyPaid: paidOut.reduce((s, r) => s + r.amount, 0),
    },
    // settled and unclaimed: pay these
    dueNowRows: owed.filter((o) => o.settledAt),
    // still open: what they would cost if that side wins
    openRows: owed.filter((o) => !o.settledAt),
    paidOut: paidOut.map((r) => ({ ...r, explorer: r.tx ? explorerTx(r.tx) : null })),
  });
}
