import type { Side } from "./types";

/**
 * Fixed-product market maker over two outcome tokens.
 *
 * The pool holds a reserve of each outcome. Collateral deposited mints one
 * of EACH outcome token (a call and a put together are always worth exactly
 * 1 unit of collateral, since exactly one of them pays), so a purchase is:
 *   mint c of both  ->  add both to the pool  ->  withdraw the wanted side
 * with the withdrawal sized so the product of reserves is unchanged.
 *
 * Price is the ratio between the reserves, which is why price and implied
 * probability are the same number: a call at 43c is the market saying 43%.
 */

export interface Reserves { call: number; put: number }

const other = (s: Side): Side => (s === "call" ? "put" : "call");

/** Spot price of one side, in collateral per share. Always in (0, 1). */
export function spotPrice(r: Reserves, side: Side): number {
  const total = r.call + r.put;
  if (total <= 0) return 0.5;
  // a side is cheap when its own reserve is deep, so price uses the OTHER side
  return r[other(side)] / total;
}

/**
 * Reference ticket every quoted multiple is measured against.
 *
 * The number has to be fixed and shared, because on a finite book a $1
 * ticket and a $500 ticket do not return the same multiple. Quoting each
 * surface off its own stake is what makes one market read as 1.2x in a
 * table and 8x on its own page.
 */
export const QUOTE_STAKE = 100;

/** Gross multiple, before the redemption fee. Prefer the net one for display. */
export function payoutMultiple(r: Reserves, side: Side, stake = QUOTE_STAKE): number {
  const { shares } = quoteBuy(r, side, stake);
  return shares / stake;
}

/**
 * Buy `side` with `collateral`.
 * Solves (a + c - x)(b + c) = a*b for x, the shares handed to the buyer.
 */
export function quoteBuy(r: Reserves, side: Side, collateral: number) {
  if (collateral <= 0) throw new Error("collateral must be positive");
  const a = r[side];
  const b = r[other(side)];
  const k = a * b;

  const bAfter = b + collateral;
  const aAfter = k / bAfter;
  const shares = a + collateral - aAfter;

  const next: Reserves = { call: 0, put: 0 };
  next[side] = aAfter;
  next[other(side)] = bAfter;

  return {
    shares,
    avgPrice: collateral / shares,
    priceBefore: spotPrice(r, side),
    priceAfter: spotPrice(next, side),
    reserves: next,
  };
}

/**
 * Sell `shares` of `side` back to the pool.
 * Returning x shares and withdrawing c collateral means burning c of each
 * outcome, so:  (a + x - c)(b - c) = a*b.  Expanded:
 *   c^2 - c(a + b + x) + x*b = 0
 * and the root we want is the smaller one (the other exceeds the reserve).
 */
export function quoteSell(r: Reserves, side: Side, shares: number) {
  if (shares <= 0) throw new Error("shares must be positive");
  const a = r[side];
  const b = r[other(side)];

  const p = a + b + shares;
  const disc = p * p - 4 * shares * b;
  if (disc < 0) throw new Error("no solution: pool too thin for this size");
  const c = (p - Math.sqrt(disc)) / 2;

  if (c >= b) throw new Error("size exceeds pool depth");

  const next: Reserves = { call: 0, put: 0 };
  next[side] = a + shares - c;
  next[other(side)] = b - c;

  return {
    collateral: c,
    avgPrice: c / shares,
    priceBefore: spotPrice(r, side),
    priceAfter: spotPrice(next, side),
    reserves: next,
  };
}

/** Largest buy that keeps average price under `maxAvg`. Used to cap size. */
export function maxBuyUnderPrice(r: Reserves, side: Side, maxAvg: number): number {
  let lo = 0, hi = (r.call + r.put) * 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid <= 0) break;
    const { avgPrice } = quoteBuy(r, side, mid);
    if (avgPrice > maxAvg) hi = mid; else lo = mid;
  }
  return lo;
}
