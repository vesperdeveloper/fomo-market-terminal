import type { Market, Snapshot, Trader, Window } from "./types";
import { valueAt, resolve } from "./settlement";
import { openingProbability, seedReserves } from "./prior";
import type { Store } from "./store";

/** Seeded depth per market.
 *
 * This has to be sized against the tickets the interface actually offers.
 * At $10 of depth a $100 buy fills ~42c away from the quoted price, so the
 * multiple shown on the card bears no relation to the fill - the quote is
 * a lie the moment anyone acts on it. $25k keeps a $100 ticket inside a
 * fraction of a cent of its quote and a $500 ticket inside ~1c. */
export const SEED_PER_MARKET = 25_000;
export const ROSTER_SIZE = 20;
export const WINDOWS: Window[] = ["24h", "7d"];

const WINDOW_MS: Record<Window, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const WINDOW_LEN: Record<Window, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * Open a market priced off the account's own record rather than at an
 * arbitrary even split. Where there is not enough history to estimate a
 * drift, the prior falls back to 50c on its own.
 */
export function openMarket(
  id: number, handle: string, window: Window, at: Date, strike: number | null,
  stats?: { drift: number; vol: number; spacingMs: number; sample: number },
): Market {
  // The horizon has to be counted in the same steps the drift and vol were
  // measured over. Assuming a fixed cadence here is what pins every market
  // to the clamp: scaling a daily drift by sqrt(288) saturates the CDF.
  const p = stats && stats.spacingMs > 0
    ? openingProbability({
        drift: stats.drift, vol: stats.vol,
        steps: WINDOW_LEN[window] / stats.spacingMs,
        sample: stats.sample,
      })
    : 0.5;
  return {
    id, handle, window,
    opensAt: at.toISOString(),
    closesAt: new Date(at.getTime() + WINDOW_MS[window]).toISOString(),
    status: "open",
    strike,
    settleValue: null, winner: null, voidReason: null,
    reserves: seedReserves(p, SEED_PER_MARKET),
    volume: 0,
    seed: SEED_PER_MARKET,
  };
}

/** Listing needs no involvement from the subject: public activity is enough. */
/**
 * Per-step drift and volatility of an account's PnL, plus the spacing those
 * steps were actually measured at, so a horizon can be expressed in them.
 */
export function stepStats(points: { t: string; pnl: number }[]) {
  if (points.length < 6) return null;

  // Absolute dollar changes, deliberately not percentages: cumulative PnL
  // wanders through zero, and dividing by a base that is briefly near zero
  // turns an ordinary step into a drift of several hundred.
  const r: number[] = [];
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    r.push(points[i].pnl - points[i - 1].pnl);
    gaps.push(new Date(points[i].t).getTime() - new Date(points[i - 1].t).getTime());
  }

  const drift = r.reduce((a, b) => a + b, 0) / r.length;
  const vol = Math.sqrt(r.reduce((a, b) => a + (b - drift) ** 2, 0) / r.length);

  // median gap, so one missing stretch does not define the cadence
  const sorted = [...gaps].sort((a, b) => a - b);
  const spacingMs = sorted[sorted.length >> 1];

  return vol > 0 && spacingMs > 0
    ? { drift, vol, spacingMs, sample: r.length }
    : null;
}

export async function ensureMarkets(
  store: Store, roster: Trader[], snapshots: Snapshot[], now = new Date(),
  seriesOf?: (handle: string) => { t: string; pnl: number }[],
) {
  const existing = await store.getMarkets();
  let nextId = existing.reduce((m, x) => Math.max(m, x.id), 0) + 1;

  for (const t of roster.slice(0, ROSTER_SIZE)) {
    for (const w of WINDOWS) {
      const live = existing.find(
        (m) => m.handle === t.handle && m.window === w && m.status === "open",
      );
      if (live) continue;
      const strike = valueAt(snapshots, t.handle, now.toISOString())?.value ?? null;
      const stats = seriesOf ? stepStats(seriesOf(t.handle)) : null;
      await store.putMarket(openMarket(nextId++, t.handle, w, now, strike, stats ?? undefined));
    }
  }
}

/** Close and resolve anything past its window. */
export async function settleDue(
  store: Store, snapshots: Snapshot[], optedOut: Set<string>, now = new Date(),
) {
  const markets = await store.getMarkets();
  const settled: Market[] = [];

  for (const m of markets) {
    if (m.status !== "open") continue;
    if (new Date(m.closesAt).getTime() > now.getTime()) continue;

    const r = resolve(snapshots, m.handle, m.opensAt, m.closesAt, {
      optedOut: optedOut.has(m.handle),
      now: now.getTime(),
    });

    if (r.kind === "void") {
      await store.putMarket({ ...m, status: "void", voidReason: r.reason });
    } else {
      await store.putMarket({
        ...m, status: "settled",
        strike: r.strike, settleValue: r.settle, winner: r.winner,
      });
    }
    settled.push(m);
  }
  return settled;
}
