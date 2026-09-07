export type Side = "call" | "put";
export type Window = "24h" | "7d";

export type MarketStatus = "open" | "closing" | "settled" | "void";

export type VoidReason =
  | "evidence_gap"      // keeper stopped reading; no usable snapshots in the window
  | "resolver_stale"    // nobody resolved within the grace period
  | "trader_opt_out"    // the subject signed to delist themselves
  | "guardian";         // cold key stopped a market that should not settle

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
  /** outcome-token reserves; price is the ratio between them */
  reserves: { call: number; put: number };
  volume: number;
  seed: number;
}

export interface Position {
  id: string;
  /** the wallet that paid for the shares, and the wallet a payout returns to */
  owner: string;
  marketId: number;
  side: Side;
  shares: number;
  /** what the shares cost, so the fee can be taken on winnings only */
  cost: number;
  createdAt: string;
  claimedAt?: string;
  payout?: number;
  /** the USDG transfer that paid for this position, verified on chain */
  depositTx?: string;
  /** the USDG transfer that settled it, once the holder has claimed */
  payoutTx?: string;
}
