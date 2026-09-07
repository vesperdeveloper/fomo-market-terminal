export const usd = (n: number, dp = 2) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });

/** Compact form for display only. Never used to settle anything. */
export const usdShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-$" : "$";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

export const pct = (n: number, dp = 1) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`;
export const cents = (p: number) => `${Math.round(p * 100)}¢`;
export const followers = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`;
export const initials = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

/** Signed dollar move, compact. The safe way to show a change in PnL. */
export const signed = (n: number) => (n >= 0 ? "+" : "\u2212") + usdShort(Math.abs(n)).replace("-", "");

/**
 * A window's move, as the record can actually support it.
 *
 * Three cases, in order. Without two readings there is nothing to compare,
 * and the honest answer is a dash — a confident "+0.0%" on an account the
 * leaderboard only started reporting an hour ago is a claim the record does
 * not make. With a starting value big enough to divide by, a ratio. And
 * where the account started near zero, the dollar move, because a ratio
 * against a near-zero base is arithmetic rather than information.
 */
export function moveLabel(
  opts: { pnl: number; delta: number; change: number; hasRecord?: boolean },
): string | null {
  const { pnl, delta, change, hasRecord = true } = opts;
  if (!hasRecord) return null;
  const start = pnl - delta;
  const usable = Math.abs(start) > Math.abs(delta) * 0.1 && Math.abs(start) > 1000;
  return usable ? pct(change) : signed(delta);
}
