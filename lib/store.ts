import type { Snapshot, Trader } from "./types";
import { postgresStore } from "./store-postgres";

/**
 * Storage.
 *
 * Deliberately small: money lives on the chain, so nothing here holds a
 * balance, a position or a pot. What is left is the evidence a market settles
 * from — the snapshot record — the roster it is written on, and the reader's
 * own session, which rotates and has to be kept somewhere.
 */
export interface Store {
  appendSnapshot(s: Snapshot): Promise<void>;
  listSnapshots(sinceMs?: number): Promise<Snapshot[]>;
  latestSnapshot(): Promise<Snapshot | null>;

  getTraders(): Promise<Trader[]>;
  putTraders(t: Trader[]): Promise<void>;

  /** The reader's rotating refresh token. Never leaves the server. */
  getSession(): Promise<string | null>;
  putSession(refreshToken: string): Promise<void>;
}

const MEM = {
  snapshots: [] as Snapshot[],
  traders: [] as Trader[],
  session: null as string | null,
};

export const memoryStore: Store = {
  async appendSnapshot(s) {
    MEM.snapshots.push(s);
    // a rolling window is enough: settlement never reaches past the
    // longest market plus the age tolerance
    const cutoff = Date.now() - 9 * 24 * 60 * 60 * 1000;
    MEM.snapshots = MEM.snapshots.filter((x) => new Date(x.t).getTime() >= cutoff);
  },
  async listSnapshots(sinceMs) {
    return sinceMs
      ? MEM.snapshots.filter((s) => new Date(s.t).getTime() >= sinceMs)
      : [...MEM.snapshots];
  },
  async latestSnapshot() {
    return MEM.snapshots.length ? MEM.snapshots[MEM.snapshots.length - 1] : null;
  },
  async getTraders() { return [...MEM.traders]; },
  async putTraders(t) { MEM.traders = t; },
  async getSession() { return MEM.session; },
  async putSession(t) { MEM.session = t; },
};

export const isDurable = () =>
  Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

/**
 * Postgres where one is configured, memory otherwise. A preview build with
 * no database still runs; it simply forgets, which is the correct behaviour
 * for a build nobody is trading against.
 */
export function getStore(): Store {
  return isDurable() ? postgresStore : memoryStore;
}
