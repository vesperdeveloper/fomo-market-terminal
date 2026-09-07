import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";
import { redeem } from "@/lib/settlement";
import { chainReady, sendPayout, explorerTx, treasuryBalance } from "@/lib/chain";

export const dynamic = "force-dynamic";

const bad = (msg: string, code = 400) => NextResponse.json({ error: msg }, { status: code });

/** What a wallet is owed, and what it has already been paid. */
export async function GET(req: Request) {
  const { store } = await ready();
  const raw = new URL(req.url).searchParams.get("owner");
  if (!raw) return bad("owner required");
  const owner = raw.toLowerCase();

  const [markets, positions] = await Promise.all([
    store.getMarkets(), store.getPositions(owner),
  ]);

  const rows = positions.map((p) => {
    const m = markets.find((x) => x.id === p.marketId);
    const settled = m?.status === "settled";
    const voided = m?.status === "void";
    const won = settled && m?.winner === p.side;
    const r = redeem(p.shares, p.cost, Boolean(won));
    // a void returns the stake itself rather than paying a winner
    const claimable = voided ? p.cost : r.net;
    return {
      id: p.id, marketId: p.marketId, side: p.side,
      shares: p.shares, cost: p.cost,
      status: m?.status ?? "unknown",
      won: Boolean(won), voided,
      claimable: p.claimedAt ? 0 : claimable,
      claimedAt: p.claimedAt ?? null,
      payoutTx: p.payoutTx ?? null,
      depositTx: p.depositTx ?? null,
    };
  });

  return NextResponse.json({
    positions: rows,
    owed: rows.reduce((s, r) => s + r.claimable, 0),
    treasury: chainReady() ? await treasuryBalance() : null,
  });
}

/**
 * Pay a settled position out of the treasury.
 *
 * The position is marked claimed BEFORE the transfer is signed. If the
 * transfer then fails the claim is released and the holder can try again;
 * if it succeeds but this process dies before recording the hash, the
 * position is still marked paid. That ordering is deliberate - the failure
 * it forecloses is paying somebody twice, which no later reconciliation
 * can undo, and the one it risks is a visible retry.
 */
export async function POST(req: Request) {
  const { store } = await ready();
  const { owner: rawOwner, position: positionId } =
    await req.json().catch(() => ({})) as { owner?: string; position?: string };
  if (!rawOwner) return bad("owner required");
  if (!positionId) return bad("position required");
  const owner = rawOwner.toLowerCase();
  if (!chainReady()) return bad("payouts are not configured on this deployment", 503);

  const positions = await store.getPositions(owner);
  const p = positions.find((x) => x.id === positionId);
  if (!p) return bad("no such position for this wallet", 404);
  if (p.claimedAt) return bad("that position has already been claimed");

  const m = (await store.getMarkets()).find((x) => x.id === p.marketId);
  if (!m) return bad("no such market", 404);
  if (m.status !== "settled" && m.status !== "void") {
    return bad(`market is still ${m.status}`);
  }

  const won = m.status === "settled" && m.winner === p.side;
  const r = redeem(p.shares, p.cost, won);
  const amount = m.status === "void" ? p.cost : r.net;

  if (!(amount > 0)) {
    // a losing ticket is closed out rather than left looking claimable
    await store.putPosition({ ...p, claimedAt: new Date().toISOString(), payout: 0 });
    return NextResponse.json({ paid: 0, reason: "that side did not win" });
  }

  const claimedAt = new Date().toISOString();
  await store.putPosition({ ...p, claimedAt, payout: amount });

  let hash: string;
  try {
    hash = await sendPayout(owner, amount);
  } catch (e) {
    // release the claim so the holder is not left unable to retry
    await store.putPosition({ ...p, claimedAt: undefined, payout: undefined });
    return bad(e instanceof Error ? e.message : "payout failed", 502);
  }

  await store.putPosition({ ...p, claimedAt, payout: amount, payoutTx: hash });

  return NextResponse.json({
    paid: amount, fee: m.status === "void" ? 0 : r.fee,
    tx: hash, explorer: explorerTx(hash),
  });
}
