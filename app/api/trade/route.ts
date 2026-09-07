import { NextResponse } from "next/server";
import { ready, isOptedOut } from "@/lib/runtime";
import { quoteBuy, quoteSell, spotPrice } from "@/lib/amm";
import { chainReady, verifyDeposit, sendPayout, explorerTx } from "@/lib/chain";
import { checkSolvency } from "@/lib/solvency";
import { isDurable } from "@/lib/store";
import type { Position, Side } from "@/lib/types";

export const dynamic = "force-dynamic";

const bad = (msg: string, code = 400) => NextResponse.json({ error: msg }, { status: code });

/** Quote without committing, so the ticket can show real numbers. */
export async function GET(req: Request) {
  const { store } = await ready();
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("market"));
  const side = u.searchParams.get("side") as Side;
  const amount = Number(u.searchParams.get("amount") ?? 100);

  const m = (await store.getMarkets()).find((x) => x.id === id);
  if (!m) return bad("no such market", 404);
  if (side !== "call" && side !== "put") return bad("side must be call or put");
  if (!(amount > 0)) return bad("amount must be positive");

  const q = quoteBuy(m.reserves, side, amount);
  return NextResponse.json({
    marketId: id, side, amount,
    shares: q.shares, avgPrice: q.avgPrice,
    priceBefore: q.priceBefore, priceAfter: q.priceAfter,
    multiple: q.shares / amount,
  });
}

export async function POST(req: Request) {
  const { store } = await ready();
  const body = await req.json().catch(() => ({}));
  const { market: id, side, amount, owner, sell, depositTx, dryRun } = body as {
    market: number; side: Side; amount: number; owner: string;
    sell?: boolean; depositTx?: string; dryRun?: boolean;
  };

  const m = (await store.getMarkets()).find((x) => x.id === id);
  if (!m) return bad("no such market", 404);
  if (m.status !== "open") return bad(`market is ${m.status}`);
  if (isOptedOut(m.handle)) return bad("the subject has opted out");
  if (side !== "call" && side !== "put") return bad("side must be call or put");
  if (!owner) return bad("owner required");
  if (!(amount > 0)) return bad("amount must be positive");

  // One canonical form for a wallet. Checksummed and lowercase spellings of
  // the same address are the same account, but not the same string, and a
  // position filed under one is invisible to a lookup by the other.
  const wallet = owner.toLowerCase();

  if (sell) {
    const held = (await store.getPositions(wallet))
      .filter((p) => p.marketId === id && p.side === side && !p.claimedAt);
    const total = held.reduce((s, p) => s + p.shares, 0);
    if (total < amount) return bad("not enough shares");

    const q = quoteSell(m.reserves, side, amount);
    await store.putMarket({ ...m, reserves: q.reserves, volume: m.volume + q.collateral });

    // retire shares oldest-first, keeping cost basis proportional
    let left = amount;
    for (const p of held) {
      if (left <= 0) break;
      const take = Math.min(p.shares, left);
      const frac = take / p.shares;
      await store.putPosition({ ...p, shares: p.shares - take, cost: p.cost * (1 - frac) });
      left -= take;
    }

    // The shares are gone by this point, so the collateral has to actually
    // leave the treasury. Retiring them without paying would take the
    // position and give nothing back.
    if (chainReady()) {
      try {
        const hash = await sendPayout(wallet, q.collateral);
        return NextResponse.json({
          sold: amount, collateral: q.collateral, avgPrice: q.avgPrice,
          tx: hash, explorer: explorerTx(hash),
        });
      } catch (e) {
        return bad(
          `shares were retired but the payout failed: ${
            e instanceof Error ? e.message : "unknown error"
          }`, 502,
        );
      }
    }
    return NextResponse.json({ sold: amount, collateral: q.collateral, avgPrice: q.avgPrice });
  }

  // ---------------------------------------------------------- real money
  let verifiedTx: string | undefined;
  if (chainReady()) {
    // Capacity is settled BEFORE the buyer is asked to pay. Checking it
    // afterwards would mean taking a stake and then refusing the ticket,
    // which is the one failure mode a buyer cannot recover from on their
    // own. `dryRun` runs exactly this branch and nothing else, so the
    // answer the client pre-flights with is the answer it will get.
    const probe = quoteBuy(m.reserves, side, amount);
    const check = await checkSolvency(
      await store.getMarkets(), await store.getPositions(), id, side, probe.shares,
    );
    if (!check.ok) return bad(check.reason ?? "insufficient collateral", 409);
    if (dryRun) {
      return NextResponse.json({ ok: true, shares: probe.shares, headroom: check.headroom });
    }

    if (!depositTx) return bad("a USDG payment is required to buy");
    if (!/^0x[0-9a-fA-F]{64}$/.test(depositTx)) return bad("that is not a transaction hash");

    // The stake has to exist on chain before any shares do. Everything the
    // browser claims about the payment is re-derived from the receipt, so a
    // forged body buys nothing.
    try {
      const dep = await verifyDeposit(depositTx as `0x${string}`, amount, wallet);
      verifiedTx = depositTx;
      if (dep.from.toLowerCase() !== wallet) {
        return bad("the payment and the position must share a wallet");
      }
    } catch (e) {
      return bad(e instanceof Error ? e.message : "could not verify that payment");
    }

    // Capacity can still have been taken by a trade that landed while this
    // buyer was signing. The stake is already on chain by now, so it is
    // sent back rather than kept against a ticket that cannot be issued.
    const after = await checkSolvency(
      await store.getMarkets(), await store.getPositions(), id, side, probe.shares,
    );
    if (!after.ok) {
      if (!(await store.claimDepositTx(verifiedTx))) {
        return bad("that payment has already been used");
      }
      try {
        const refund = await sendPayout(wallet, amount);
        return bad(
          `${after.reason ?? "insufficient collateral"} - your ${amount} USDG has been sent back (${refund})`,
          409,
        );
      } catch {
        return bad(
          `${after.reason ?? "insufficient collateral"} - your ${amount} USDG could not be ` +
          `returned automatically; quote the payment ${verifiedTx} to have it refunded`,
          502,
        );
      }
    }
  } else if (dryRun) {
    return NextResponse.json({ ok: true });
  }

  // with a database the whole buy runs under a row lock, so two trades
  // landing together cannot both price off the same starting reserves
  if (isDurable()) {
    const { tradeAtomic } = await import("@/lib/store-postgres");
    try {
      const r = await tradeAtomic(id, side, amount, wallet, verifiedTx);
      return NextResponse.json({
        position: r.position, avgPrice: r.avgPrice, price: r.priceAfter,
      });
    } catch (e) {
      return bad(e instanceof Error ? e.message : "trade failed");
    }
  }

  if (verifiedTx && !(await store.claimDepositTx(verifiedTx))) {
    return bad("that payment has already been used");
  }

  const q = quoteBuy(m.reserves, side, amount);

  // a fill far from the quoted price is a broken quote, not a trade
  const slip = Math.abs(q.avgPrice - q.priceBefore);
  if (slip > 0.05) {
    return bad(
      `size too large for current depth: this would fill ${(slip * 100).toFixed(1)}c ` +
      `from the ${(q.priceBefore * 100).toFixed(1)}c quote`,
    );
  }

  await store.putMarket({ ...m, reserves: q.reserves, volume: m.volume + amount });

  const pos: Position = {
    id: `${id}-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    owner: wallet, marketId: id, side,
    shares: q.shares, cost: amount,
    createdAt: new Date().toISOString(),
    depositTx: verifiedTx,
  };
  await store.putPosition(pos);

  return NextResponse.json({
    position: pos,
    avgPrice: q.avgPrice,
    price: spotPrice(q.reserves, side),
  });
}
