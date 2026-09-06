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
