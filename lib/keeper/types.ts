import type { Snapshot, Trader } from "../types";

export interface Reading {
  snapshot: Snapshot;
  traders: Trader[];
}

/** A source of leaderboard readings. One read = one snapshot file. */
export interface KeeperAdapter {
  readonly name: string;
  read(): Promise<Reading>;
}
