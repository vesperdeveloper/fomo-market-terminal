import { getStore, isDurable } from "./store";
import { SimAdapter } from "./keeper/sim";
import { FomoAdapter } from "./keeper/fomo";
import type { KeeperAdapter } from "./keeper/types";
import { ensureMarkets, settleDue, ROSTER_SIZE } from "./markets";
import type { Trader } from "./types";

/** Accounts the markets are written on. Held here so the roster is one
 *  edit, and so the sim and the live adapter agree on who is listed. */
export const ROSTER: Trader[] = [
  { handle: "unipcs",         name: "Unipcs",          followers: 460_000 },
  { handle: "AvgJoesCrypto",  name: "AJC",             followers: 90_000 },
  { handle: "frogmanhaha",    name: "Frogman",         followers: 45_000 },
  { handle: "change",         name: "change",          followers: 337_000 },
  { handle: "DumbCrayonEater",name: "DumbCrayonEater", followers: 447_000 },
  { handle: "Salem1299534",   name: "Salem",           followers: 175_000 },
  { handle: "ether_monk",     name: "Ethermonk",       followers: 318_000 },
  { handle: "Natan_benish",   name: "Nate",            followers: 76_000 },
  { handle: "brrrgrrrz",      name: "Burgz",           followers: 72_000 },
  { handle: "notanicecat69",  name: "Wood",            followers: 49_000 },
];

export function adapter(): KeeperAdapter {
  const fomo = new FomoAdapter();
  // fall back to the simulator when no session is configured, so the
  // product runs end to end while the live source is unavailable
  return fomo.configured ? fomo : new SimAdapter(ROSTER);
}

const optedOut = new Set<string>();
export function optOut(handle: string) { optedOut.add(handle); }
export function isOptedOut(h: string) { return optedOut.has(h); }

let booted = false;

/** A source that is not the local simulator. */
const isReal = (source: string) => !source.startsWith("sim://");

/**
 * The record, ready to read.
 *
 * `manage` is what separates a page render from the keeper's tick. Opening
 * and settling markets is a write, and doing it as a side effect of drawing
 * a page meant every visitor paid for it — including the reads it needs. A
 * render asks for `manage: false` and gets only what it is going to show;
 * the ingest endpoint asks for the whole record and does the managing.
 */
export async function ready(opts: { manage?: boolean; sinceMs?: number } = {}) {
  const { manage = true, sinceMs } = opts;
  const store = getStore();
  if (!booted) {
    booted = true;
    const existing = await store.listSnapshots();

    // Never let the simulator write into a record that already holds real
    // readings. Settlement takes a median across snapshots, so a mixed
    // record would let synthetic numbers decide a real market.
    const hasReal = existing.some((s) => isReal(s.source));
    const seedingAllowed = !hasReal && existing.length === 0 && process.env.ALLOW_SIM !== "0";

    if (seedingAllowed) {
      const a = adapter();
      for (let i = 0; i < 6; i++) {
        try {
          const { snapshot } = await a.read();
          if (isReal(snapshot.source)) { await store.appendSnapshot(snapshot); continue; }
          await store.appendSnapshot(snapshot);
        } catch { break; }
      }
      await store.putTraders(ROSTER);
    }
  }
  const snaps = await store.listSnapshots(sinceMs);
  if (!manage) return { store, snaps };

  const traders = await store.getTraders();

  // the opening prior is estimated from each account's own history, so the
  // two sides of a new market rarely start level
  let seriesOf: ((h: string) => { t: string; pnl: number }[]) | undefined;
  if (isDurable()) {
    try {
      const { getHistoryMany } = await import("./store-postgres");
      const m = await getHistoryMany(traders.slice(0, ROSTER_SIZE).map((t) => t.handle));
      seriesOf = (h) => m[h] ?? [];
    } catch { seriesOf = undefined; }
  }

  await ensureMarkets(store, traders.slice(0, ROSTER_SIZE), snaps, new Date(), seriesOf);
  await settleDue(store, snaps, optedOut);
  return { store, snaps };
}
