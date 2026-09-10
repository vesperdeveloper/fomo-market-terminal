import type { Market, Position, Snapshot, Trader } from "./types";
import { postgresStore } from "./store-postgres";

/**
 * Storage interface. Snapshots are append-only and served read-only;
 * markets and positions are mutable. The file implementation is for local
 * work, the memory one for preview builds, and a KV implementation slots
 * in behind the same interface for production.
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

  getMarkets(): Promise<Market[]>;
  putMarket(m: Market): Promise<void>;

  getPositions(owner?: string): Promise<Position[]>;
  putPosition(p: Position): Promise<void>;

  /**
   * Take ownership of a deposit transaction, returning false if it has
   * already been spent. One payment buys one position: without this a
   * single transfer could be replayed into as many tickets as the caller
   * cared to ask for.
   */
  claimDepositTx(hash: string): Promise<boolean>;
}

const MEM = {
  snapshots: [] as Snapshot[],
  traders: [] as Trader[],
  markets: [] as Market[],
  positions: [] as Position[],
  spentTx: new Set<string>(),
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
  async getMarkets() { return [...MEM.markets]; },
  async putMarket(m) {
    const i = MEM.markets.findIndex((x) => x.id === m.id);
    if (i >= 0) MEM.markets[i] = m; else MEM.markets.push(m);
  },
  async getPositions(owner) {
    // same rule as the durable store: an address has two spellings
    const want = owner?.toLowerCase();
    return want ? MEM.positions.filter((p) => p.owner.toLowerCase() === want) : [...MEM.positions];
  },
  async putPosition(p) {
    const i = MEM.positions.findIndex((x) => x.id === p.id);
    if (i >= 0) MEM.positions[i] = p; else MEM.positions.push(p);
  },
  async claimDepositTx(hash) {
    const key = hash.toLowerCase();
    if (MEM.spentTx.has(key)) return false;
    MEM.spentTx.add(key);
    return true;
  },
};

export const isDurable = () =>
  Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

/**
 * Postgres when a connection string is configured, memory otherwise.
 *
 * The memory store is only viable for a single long-lived process: on
 * serverless it is per-invocation, so positions and the snapshot history
 * both evaporate between requests. Anything real needs the database.
 */
export function getStore(): Store {
  // the pg pool is created lazily on first query, so importing this
  // unconditionally costs nothing when no database is configured
  return isDurable() ? postgresStore : memoryStore;
}


