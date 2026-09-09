import { ready } from "./runtime";
import { ROSTER_SIZE } from "./markets";
import { spotPrice, quoteBuy, QUOTE_STAKE } from "./amm";
import { netMultiple } from "./prior";
import { valueAt } from "./settlement";
import type { Market, Snapshot, Trader } from "./types";
import { isDurable } from "./store";

export interface Series { t: string; pnl: number }

export interface Row {
  trader: Trader;
  pnl: number;
  /** live readings, newest last */
  series: number[];
  /** real historical PnL per range, for the chart */
  history: { "24h": Series[]; "7d": Series[]; "30d": Series[]; all: Series[] };
  change24h: number;
  change7d: number;
  change30d: number;
  /** dollar moves, safe to display where a ratio is not */
  delta24h: number;
  delta7d: number;
  delta30d: number;
  markets: Market[];
  stats: { vol: number; winRate: number; volume30d: number; trades: number };
  /**
   * Whether there is enough on record to say how this account moved.
   *
   * A handle the leaderboard only started reporting an hour ago has no
   * history and one reading, and every derived figure for it comes out as
   * zero. Zero is a claim — that the account did not move — and it is not
   * one the record supports, so the interface is told to say nothing instead.
   */
  hasRecord: boolean;
}

const RANGE_MS = { "24h": 864e5, "7d": 6048e5, "30d": 2592e6, all: Infinity } as const;

/** Split one handle's history into the ranges the card offers. */
function bucket(points: Series[]) {
  const now = points.length ? new Date(points[points.length - 1].t).getTime() : Date.now();
  const pick = (ms: number) =>
    ms === Infinity ? points : points.filter((p) => new Date(p.t).getTime() >= now - ms);
  return {
    "24h": pick(RANGE_MS["24h"]), "7d": pick(RANGE_MS["7d"]),
    "30d": pick(RANGE_MS["30d"]), all: points,
  };
}

const seriesFor = (snaps: Snapshot[], handle: string, n = 60) =>
  snaps.filter((s) => typeof s.pnl[handle] === "number").slice(-n).map((s) => s.pnl[handle]);

/**
 * Per-step volatility of PnL, in dollars.
 *
 * Deliberately not a percentage: cumulative PnL passes through zero, and a
 * return taken against a near-zero base produces a sigma in the thousands
 * of percent, which is a display bug rather than a fact about the account.
 */
function realisedVol(xs: number[]) {
  if (xs.length < 3) return 0;
  const d: number[] = [];
  for (let i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const v = d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length;
  return Math.sqrt(v);
}

/**
 * Change across one bucket, computed from exactly the points the chart for
 * that range draws. Deriving it any other way lets the headline number and
 * the line underneath it disagree, which happened: a stat row reading +576%
 * above a panel reading +523% for the same week.
 *
 * When the record does not reach back far enough for a range, the oldest
 * point available is used rather than returning nothing - a 29-day history
 * asked for 30 days should report what it has, not silently read 0.0%.
 */
function changeOfBucket(bucketed: Series[]): number {
  if (bucketed.length < 2) return 0;
  const a = bucketed[0].pnl;
  const b = bucketed[bucketed.length - 1].pnl;
  return (b - a) / (Math.abs(a) || 1);
}

/**
 * Dollar change across a bucket.
 *
 * The percentage form is unusable on this underlying: cumulative PnL starts
 * near zero and can cross it, so the ratio is either enormous or undefined -
 * a real account read +27068% over 30 days purely because its first recorded
 * point was small. The dollar move is what the number actually means, and it
 * is what the source itself reports.
 */
function deltaOfBucket(bucketed: Series[]): number {
  if (bucketed.length < 2) return 0;
  return bucketed[bucketed.length - 1].pnl - bucketed[0].pnl;
}

const changeOver = (snaps: Snapshot[], handle: string, ms: number, now: number) => {
  const cur = valueAt(snaps, handle, new Date(now).toISOString())?.value;
  const then = valueAt(snaps, handle, new Date(now - ms).toISOString())?.value;
  if (cur == null || then == null) return 0;
  const base = Math.abs(then) || 1;
  return (cur - then) / base;
};

/** A day and a bit: everything the board renders reaches back no further. */
const BOARD_WINDOW_MS = 26 * 60 * 60 * 1000;

export async function board(): Promise<{ rows: Row[]; readAt: string | null; source: string | null }> {
  // A database that is down, over quota or simply slow must not take the site
  // with it. Every page here is a read of a record; if the record cannot be
  // read the honest answer is an empty board, not a 500 — and not, as it was,
  // a build that refuses to finish.
  try {
    return await readBoard();
  } catch (e) {
    console.error("board unavailable:", (e as Error).message);
    return { rows: [], readAt: null, source: null };
  }
}

async function readBoard(): Promise<{ rows: Row[]; readAt: string | null; source: string | null }> {
  // A render reads; it does not open or settle markets, and it does not need
  // the nine days of readings a settlement reaches back through.
  const { store, snaps } = await ready({ manage: false, sinceMs: Date.now() - BOARD_WINDOW_MS });
  const [traders, markets] = await Promise.all([store.getTraders(), store.getMarkets()]);

  const last = snaps[snaps.length - 1] ?? null;
  const now = last ? new Date(last.t).getTime() : Date.now();

  // Rank first, then fetch. The record holds every account the leaderboard
  // reports; the board shows ten of them, and pulling history for the other
  // ninety was a round trip each for rows nobody was going to see.
  const ranked = traders
    .map((t) => ({ t, pnl: lastValue(snaps, t.handle) }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, ROSTER_SIZE);

  let hist: Record<string, Series[]> = {};
  if (isDurable()) {
    try {
      const { getHistoryMany } = await import("./store-postgres");
      hist = await getHistoryMany(ranked.map((r) => r.t.handle));
    } catch { hist = {}; }
  }

  const rows = ranked.map(({ t, pnl: latest }) => {
    const live = seriesFor(snaps, t.handle);
    const points = hist[t.handle] ?? [];
    // history first, then anything the keeper has read since
    const series = points.length ? [...points.map((p) => p.pnl), ...live] : live;
    const buckets = bucket(points);
    const pnl = live.length ? live[live.length - 1] : (points.at(-1)?.pnl ?? latest);
    const wins = series.filter((v, i) => i > 0 && v > series[i - 1]).length;
    return {
      trader: t,
      pnl,
      series,
      history: buckets,
      change24h: buckets["24h"].length > 1
        ? changeOfBucket(buckets["24h"]) : changeOver(snaps, t.handle, 864e5, now),
      change7d: buckets["7d"].length > 1
        ? changeOfBucket(buckets["7d"]) : changeOver(snaps, t.handle, 6048e5, now),
      change30d: changeOfBucket(buckets["30d"].length > 1 ? buckets["30d"] : buckets.all),
      delta24h: deltaOfBucket(buckets["24h"]),
      delta7d: deltaOfBucket(buckets["7d"]),
      delta30d: deltaOfBucket(buckets["30d"].length > 1 ? buckets["30d"] : buckets.all),
      // two points from somewhere is the least it takes to have moved at all
      hasRecord: points.length > 1 || live.length > 1,
      markets: markets.filter((m) => m.handle === t.handle && m.status === "open"),
      stats: {
        vol: realisedVol(series),
        winRate: series.length > 1 ? wins / (series.length - 1) : 0,
        volume30d: markets.filter((m) => m.handle === t.handle).reduce((s, m) => s + m.volume, 0),
        trades: 0,
      },
    };
  });

  return { rows, readAt: last?.t ?? null, source: last?.source ?? null };
}

/** The newest reading the record holds for a handle, or zero. */
function lastValue(snaps: Snapshot[], handle: string) {
  for (let i = snaps.length - 1; i >= 0; i--) {
    const v = snaps[i].pnl[handle];
    if (typeof v === "number") return v;
  }
  return 0;
}

export const priceOf = (m: Market, side: "call" | "put") => spotPrice(m.reserves, side);

/**
 * The multiple a card should show: what a real ticket returns after the
 * redemption fee, not the gross ratio. A flat book quotes 1.98x, not 2.00x.
 */
export const multipleOf = (m: Market, side: "call" | "put", stake = QUOTE_STAKE) => {
  try { return netMultiple(quoteBuy(m.reserves, side, stake).shares, stake); }
  catch { return 1; }
};
