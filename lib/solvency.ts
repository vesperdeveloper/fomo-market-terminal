import type { Market, Position, Side } from "./types";
import { treasuryBalance } from "./chain";

/**
 * What the treasury could still be asked to pay.
 *
 * Exactly one side of a binary market pays, so a market's worst case is
 * the larger of its two outstanding share counts - not their sum. Shares
 * are bounded above by their own count because a winning share redeems for
 * one USDG less the fee taken from its winnings, so counting the fee as
 * zero is deliberately conservative.
 *
 * A settled market still counts until its positions are actually claimed:
 * money owed is money owed whether or not the holder has come to collect.
 */
export function worstCaseLiability(markets: Market[], positions: Position[]): number {
  const open = new Map<number, { call: number; put: number }>();

  for (const p of positions) {
    if (p.claimedAt) continue;
    const m = markets.find((x) => x.id === p.marketId);
    if (!m || m.status === "void") continue;

    const bucket = open.get(p.marketId) ?? { call: 0, put: 0 };
    // once a market has settled only the winning side can still be paid
    if (!m.winner || m.winner === p.side) bucket[p.side] += p.shares;
    open.set(p.marketId, bucket);
  }

  let total = 0;
  for (const b of open.values()) total += Math.max(b.call, b.put);
  return total;
}

/** Liability if `shares` more of `side` were sold in `marketId` right now. */
export function liabilityWith(
  markets: Market[], positions: Position[],
  marketId: number, side: Side, shares: number,
): number {
  const hypothetical: Position = {
    id: "__probe__", owner: "__probe__", marketId, side,
    shares, cost: 0, createdAt: new Date().toISOString(),
  };
  return worstCaseLiability(markets, [...positions, hypothetical]);
}

/**
 * Fraction of the treasury left unlent, so a payout is never the exact
 * last dollar in the account and a fee or a rounding step cannot make a
 * settled market unpayable.
 */
export const RESERVE_BUFFER = 0.02;

/**
 * Let the book take stakes it cannot currently cover.
 *
 * With this set the venue can owe more than it holds, and the shortfall is
 * the operator's to settle by hand. It is deliberately an explicit switch
 * rather than a default: the guard exists because an AMM will quote depth
 * no money stands behind, and turning it off moves that risk onto whoever
 * runs the treasury.
 */
export const unbackedAllowed = () =>
  process.env.ALLOW_UNBACKED === "1";

export interface SolvencyCheck {
  ok: boolean;
  balance: number;
  liability: number;
  headroom: number;
  reason?: string;
}

/**
 * Gate a prospective buy on the treasury being able to honour it.
 *
 * The AMM will happily quote depth that no money stands behind - its seed
 * reserves are a pricing device, not a bank balance - so this is the check
 * that keeps the two in agreement. A trade that would let the book promise
 * more than the treasury holds is refused at the door, which is a worse
 * experience for one buyer and a solvent one for everybody already in.
 */
export async function checkSolvency(
  markets: Market[], positions: Position[],
  marketId: number, side: Side, shares: number,
): Promise<SolvencyCheck> {
  const balance = await treasuryBalance();
  const liability = liabilityWith(markets, positions, marketId, side, shares);
  const usable = balance * (1 - RESERVE_BUFFER);
  const headroom = usable - liability;

  if (headroom < 0) {
    const reason =
      `this fill would put ${liability.toFixed(2)} USDG of promises against ` +
      `${balance.toFixed(2)} USDG of collateral`;
    // the shortfall is still measured and reported; it just stops being a
    // refusal, because somebody has taken on settling it themselves
    return unbackedAllowed()
      ? { ok: true, balance, liability, headroom, reason }
      : { ok: false, balance, liability, headroom, reason };
  }
  return { ok: true, balance, liability, headroom };
}
