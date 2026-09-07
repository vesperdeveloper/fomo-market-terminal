import { FEE_BPS } from "./settlement";

/**
 * Opening odds.
 *
 * A market seeded flat says the two sides are equally likely, which is a
 * claim about the trader that the record usually contradicts. Instead the
 * opening price is the model's probability that the account's cumulative
 * PnL is higher at the close than at the open.
 *
 * Treating PnL as a walk with drift mu and per-step volatility sigma over a
 * horizon of n steps, that probability is P(sum > 0) = Phi(mu*sqrt(n)/sigma).
 * Crypto returns are fat-tailed, so the normal tail understates how often a
 * quiet account stays quiet; a Student-t with few degrees of freedom pulls
 * the result back toward even, which is the conservative direction for a
 * book that has to quote both sides.
 */

/** Student-t CDF, nu = 4, via an incomplete-beta continued fraction. */
function studentT(x: number, nu = 4): number {
  const p = 1 - 0.5 * ibeta(nu / (nu + x * x), nu / 2, 0.5);
  return x >= 0 ? p : 1 - p;
}

function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = gammaln(a) + gammaln(b) - gammaln(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -(((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d; f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  const r = front * (f - 1);
  return a > 1 && b > 1 && x > (a + 1) / (a + b + 2) ? 1 - r : r;
}

function gammaln(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export interface PriorInputs {
  /** mean per-step change in PnL, in dollars */
  drift: number;
  /** standard deviation of that change, in dollars */
  vol: number;
  /** how many steps the market's window spans */
  steps: number;
  /** how many steps the estimate was made from */
  sample: number;
}

/**
 * Probability the call side lands.
 *
 * Over n steps the projected change has mean n*mu and variance n*sigma^2.
 * But mu is itself estimated from a finite sample, with standard error
 * sigma/sqrt(N), and that uncertainty grows as n^2 over the horizon:
 *
 *   Var(sum) = n*sigma^2 + n^2*sigma^2/N
 *
 * Ignoring the second term is what makes a long window look near-certain
 * off a short record - it treats a noisy drift estimate as a known fact.
 * Including it damps the horizon by sqrt(1 + n/N), which is exactly the
 * penalty for predicting far beyond what has been observed.
 */
export function openingProbability({ drift, vol, steps, sample }: PriorInputs): number {
  if (!Number.isFinite(drift) || !Number.isFinite(vol) || vol <= 0 || steps <= 0) return 0.5;
  const n = steps;
  const N = Math.max(2, sample);
  const sd = vol * Math.sqrt(n + (n * n) / N);
  if (!(sd > 0) || !Number.isFinite(sd)) return 0.5;
  const t = (n * drift) / sd;
  return Math.min(0.85, Math.max(0.15, studentT(t, 4)));
}

/**
 * Reserves that price the call at `p` while holding `seed` on each side of
 * an even book. price_call = put / (call + put), so put = 2*seed*p.
 */
export function seedReserves(p: number, seed: number) {
  const total = 2 * seed;
  return { call: total * (1 - p), put: total * p };
}

/** The multiple actually paid out, after the redemption fee on winnings. */
export function netMultiple(grossShares: number, stake: number): number {
  const winnings = Math.max(0, grossShares - stake);
  const fee = (winnings * FEE_BPS) / 10_000;
  return (grossShares - fee) / stake;
}
