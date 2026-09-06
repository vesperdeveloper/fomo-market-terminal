import type { Side } from "./types";

/**
 * Parimutuel arithmetic, in dollars.
 *
 * These are the same three formulas the contract runs, kept here so the page
 * can quote a ticket without a round trip to the chain. They are deliberately
 * a mirror rather than a model: if one of them ever disagrees with
 * FomoMarket.sol, this file is the one that is wrong.
 */

/** Fee taken on winnings at claim. Matches FEE_BPS in the contract. */
export const FEE_BPS = 200;
/** Half of that fee is held for the account the market is written on. */
export const ESCROW_SHARE_BPS = 5000;

export interface Pools { call: number; put: number }

const sideOf = (p: Pools, s: Side) => (s === "call" ? p.call : p.put);
const otherOf = (p: Pools, s: Side) => (s === "call" ? p.put : p.call);

/**
 * What the book says the odds are: a side's share of the pot.
 *
 * An empty pot has no opinion, so it reads level rather than dividing by
 * zero. A pot where one side has never traded reads at the extreme, which is
 * honest — that market has no counterparty yet and will void if it stays
 * that way.
 */
export function impliedPrice(pools: Pools, side: Side): number {
  const total = pools.call + pools.put;
  if (total <= 0) return 0.5;
  return sideOf(pools, side) / total;
}

/**
 * The multiple a `stake` on `side` would be paid at if the book closed as it
 * stands, net of the fee. This is what the interface quotes, and unlike an
 * AMM quote it moves against you only through your own size: the ticket you
 * are about to write is already counted in the denominator.
 */
export function multiple(pools: Pools, side: Side, stake: number): number {
  if (!(stake > 0)) return 1;
  const win = sideOf(pools, side) + stake;
  const lose = otherOf(pools, side);
  if (lose <= 0) return 1;
  const gross = (stake * lose) / win;
  const net = gross - (gross * FEE_BPS) / 10_000;
  return (stake + net) / stake;
}

/** Dollars a winning `stake` returns, stake included, net of the fee. */
export function payout(pools: Pools, side: Side, stake: number): number {
  return stake * multiple(pools, side, stake);
}

/**
 * How far this ticket moves the quote. Not slippage against a maker — there
 * is no maker — but dilution: a big ticket on a thin side shares the same
 * losing pot with itself.
 */
export function dilution(pools: Pools, side: Side, stake: number): number {
  const before = multiple(pools, side, 0.000001);
  const after = multiple(pools, side, stake);
  if (before <= 1) return 0;
  return Math.max(0, (before - after) / (before - 1));
}

/** The pot, which is also the volume: nothing leaves before settlement. */
export const potOf = (pools: Pools) => pools.call + pools.put;
