import type { Snapshot, Side, VoidReason } from "./types";

/** Older than this and a reading cannot value a moment. */
export const MAX_SNAPSHOT_AGE_MS = 20 * 60 * 1000;
/** How many readings each end of a market is built from. */
export const SETTLEMENT_SNAPSHOTS = 3;
/** After this, anyone may void a market whose resolver went dark. */
export const RESOLVER_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const FEE_BPS = 200;            // 2%, on winnings only
/** Where the fee goes, as the contract splits it. Half is held for the
 *  account the market was written on; the rest is the venue's. */
export const FEE_SPLIT = { traderEscrow: 50, venue: 50 };

const ms = (iso: string) => new Date(iso).getTime();
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Valuation {
  value: number;
  used: Snapshot[];
}

/**
 * Value a handle at a moment: the median of the 3 nearest snapshots.
 *
 * Taking three and discarding the outlier means one corrupted or
 * cherry-picked reading cannot decide a market on its own. The age filter
 * is the other half: a stale file is dropped instead of being stretched
 * across a window the keeper was not actually awake for.
 */
export function valueAt(
  snapshots: Snapshot[],
  handle: string,
  at: string,
): Valuation | null {
  const target = ms(at);

  const eligible = snapshots
    .filter((s) => typeof s.pnl[handle] === "number")
    .filter((s) => Math.abs(ms(s.t) - target) <= MAX_SNAPSHOT_AGE_MS)
    .sort((a, b) => Math.abs(ms(a.t) - target) - Math.abs(ms(b.t) - target))
    .slice(0, SETTLEMENT_SNAPSHOTS);

  // refuse to guess rather than settle on thin evidence
  if (eligible.length < SETTLEMENT_SNAPSHOTS) return null;

  return { value: median(eligible.map((s) => s.pnl[handle])), used: eligible };
}

export type Resolution =
  | { kind: "settled"; strike: number; settle: number; winner: Side; evidence: Snapshot[] }
  | { kind: "void"; reason: VoidReason };

/**
 * Resolve a market, or refuse to. Forcing a resolution on incomplete
 * evidence is strictly worse for position holders than a refund, so every
 * path that cannot be defended from the snapshot record ends in a void.
 */
export function resolve(
  snapshots: Snapshot[],
  handle: string,
  opensAt: string,
  closesAt: string,
  opts: { optedOut?: boolean; guardianVoid?: boolean; now?: number } = {},
): Resolution {
  if (opts.optedOut) return { kind: "void", reason: "trader_opt_out" };
  if (opts.guardianVoid) return { kind: "void", reason: "guardian" };

  const open = valueAt(snapshots, handle, opensAt);
  const close = valueAt(snapshots, handle, closesAt);

  if (!open || !close) {
    const now = opts.now ?? Date.now();
    if (now - ms(closesAt) > RESOLVER_GRACE_MS) {
      return { kind: "void", reason: "resolver_stale" };
    }
    return { kind: "void", reason: "evidence_gap" };
  }

  return {
    kind: "settled",
    strike: open.value,
    settle: close.value,
    // strict inequality: an unchanged number resolves to the put side
    winner: close.value > open.value ? "call" : "put",
    evidence: [...open.used, ...close.used],
  };
}

/** Where the fee goes, for the receipt shown on the docs page. */
export function feeSplit(fee: number) {
  const pct = (n: number) => (fee * n) / 100;
  return { traderEscrow: pct(FEE_SPLIT.traderEscrow), venue: pct(FEE_SPLIT.venue) };
}

/**
 * Reject abbreviated figures. At "$6.8M" of precision, a day's worth of
 * real movement is invisible: both ends of the window parse to the same
 * number and every call holder is settled into a loss they did not earn.
 */
export function parseExactUsd(raw: string): number | null {
  const t = raw.trim().replace(/[$,\s]/g, "");
  if (/[KkMmBb]$/.test(t)) return null;      // rounded - not good enough to settle
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
