import type { KeeperAdapter, Reading } from "./types";
import type { Trader } from "../types";

/**
 * Deterministic stand-in for a live source, so the full pipeline -
 * snapshots, medians, strikes, settlement, redemption - can be exercised
 * without credentials. Walks each account's PnL with a seeded random walk
 * so repeated runs are reproducible.
 */
export class SimAdapter implements KeeperAdapter {
  readonly name = "sim://local";

  constructor(private roster: Trader[], private seed = 1) {}

  private rand(n: number) {
    // xorshift, seeded per (account, tick) so history is stable
    let x = (this.seed ^ (n * 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    return x / 0xffffffff;
  }

  read(): Promise<Reading> {
    const now = Date.now();
    const tick = Math.floor(now / (5 * 60 * 1000));
    const pnl: Record<string, number> = {};

    this.roster.forEach((t, i) => {
      const base = 250_000 * (this.roster.length - i);
      let v = base;
      // 9 days of 5-minute steps, enough to settle the longest window
      for (let k = tick - 2592; k <= tick; k++) {
        v += (this.rand(k * 31 + i) - 0.49) * base * 0.004;
      }
      pnl[t.handle] = Math.round(v * 100) / 100;
    });

    return Promise.resolve({
      snapshot: { t: new Date(now).toISOString(), source: this.name, pnl },
      traders: this.roster,
    });
  }
}
