import { getStore } from "./store";
import { SimAdapter } from "./keeper/sim";
import { FomoAdapter } from "./keeper/fomo";
import type { KeeperAdapter } from "./keeper/types";
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

const optedOut = new Set<string>(
  (process.env.OPTED_OUT ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
export function optOut(handle: string) { optedOut.add(handle); }
export function isOptedOut(h: string) { return optedOut.has(h); }

let booted = false;

/** A source that is not the local simulator. */
const isReal = (source: string) => !source.startsWith("sim://");

/**
 * The record, ready to read.
 *
 * This used to open and settle markets as a side effect of rendering a page.
 * It no longer does: markets live in a contract now, and the only thing that
 * touches them is the oracle, on its own schedule. What is left here is the
 * evidence and the roster.
 */
export async function ready() {
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
          await store.appendSnapshot(snapshot);
        } catch { break; }
      }
      await store.putTraders(ROSTER);
    }
  }
  const snaps = await store.listSnapshots();
  return { store, snaps };
}
