export type Side = "call" | "put";
export type Window = "24h" | "7d";

export type MarketStatus = "open" | "settled" | "void";

export type VoidReason =
  | "evidence_gap"      // keeper stopped reading; no usable snapshots in the window
  | "resolver_stale"    // nobody resolved within the grace period
  | "trader_opt_out"    // the subject signed to delist themselves
  | "one_sided"         // nobody took the other side, so there is nothing to win
  | "guardian";         // the oracle stopped a market that should not settle

export interface Trader {
  handle: string;
  name: string;
  bio?: string;
  followers: number;
  avatar?: string;
  banner?: string;
  /** fomo's internal user id, needed to pull historical PnL */
  fomoId?: string;
}

/** One reading of the leaderboard. This is the evidence; everything
 *  downstream is derived from it and nothing else. */
export interface Snapshot {
  /** ISO-8601, when the read happened */
  t: string;
  /** where it came from, so a settlement can be audited to a source */
  source: string;
  /** handle -> total account PnL in dollars, signed */
  pnl: Record<string, number>;
}

/**
 * A market, as the contract holds it.
 *
 * There are no reserves here and no seed, because there is no maker: the two
 * pools are simply what each side has staked, and everything the interface
 * quotes is derived from their ratio. `id` is the on-chain market id, which
 * is what every URL, ticket and claim is keyed on.
 */
export interface Market {
  id: number;
  handle: string;
  window: Window;
  opensAt: string;
  closesAt: string;
  status: MarketStatus;
  /** total account PnL at the open: a commitment, not an input */
  strike: number | null;
  settleValue: number | null;
  winner: Side | null;
  voidReason: VoidReason | null;
  /** staked on each side, in USDG */
  pools: { call: number; put: number };
  /** the pot, which is also the traded volume */
  volume: number;
}

/** A stake, read back from the chain rather than kept in a database. */
export interface Position {
  marketId: number;
  owner: string;
  side: Side;
  /** what it cost, which is also what it is worth if the market voids */
  stake: number;
  /** what the holder would be paid if the book closed as it stands */
  markedAt: number;
  claimed: boolean;
  /** paid out, once the market is settled and the holder has claimed */
  payout?: number;
}
