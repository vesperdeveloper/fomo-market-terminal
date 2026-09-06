import type { Address } from "viem";
import { artifacts } from "./artifacts";
import { publicClient, marketAddress, fromUnits, toUnits } from "./chain";
import { multiple } from "./pool";
import type { Market, Position, Side, Window } from "./types";

export const marketAbi = artifacts.FomoMarket.abi;

const WINDOW_OF: Record<number, Window> = { 86400: "24h", 604800: "7d" };
export const SECONDS_OF: Record<Window, number> = { "24h": 86400, "7d": 604800 };
export const SIDE_INDEX: Record<Side, number> = { call: 0, put: 1 };
const SIDE_OF: Side[] = ["call", "put"];

/** PnL is carried on chain as a signed integer with six decimals. */
export const toPnlUnits = (usd: number): bigint => toUnits(usd);
export const fromPnlUnits = (units: bigint): number => fromUnits(units);

interface RawMarket {
  handleHash: `0x${string}`;
  opensAt: bigint;
  closesAt: bigint;
  window: number;
  status: number;
  winner: number;
  strike: bigint;
  settle: bigint;
  poolUp: bigint;
  poolDown: bigint;
  paidOut: bigint;
}

function shape(id: number, handle: string, m: RawMarket): Market {
  const pools = { call: fromUnits(m.poolUp), put: fromUnits(m.poolDown) };
  const status = m.status === 0 ? "open" : m.status === 1 ? "settled" : "void";
  return {
    id,
    handle,
    window: WINDOW_OF[m.window] ?? "24h",
    opensAt: new Date(Number(m.opensAt) * 1000).toISOString(),
    closesAt: new Date(Number(m.closesAt) * 1000).toISOString(),
    status,
    strike: fromPnlUnits(m.strike),
    settleValue: status === "settled" ? fromPnlUnits(m.settle) : null,
    winner: status === "settled" ? SIDE_OF[m.winner] : null,
    // the contract records why in an event; the one case worth naming without
    // reading logs is the market nobody took the other side of
    voidReason:
      status === "void" && (pools.call === 0 || pools.put === 0) ? "one_sided" : null,
    pools,
    volume: pools.call + pools.put,
  };
}

/**
 * Every market the contract holds, newest id last.
 *
 * There is no database copy of this. The chain is the book, and a page that
 * renders a pot renders the pot the contract would pay out of a second later.
 */
export async function readMarkets(): Promise<Market[]> {
  const address = marketAddress();
  if (!address) return [];

  const count = Number(await publicClient.readContract({
    address, abi: marketAbi, functionName: "marketCount",
  }));
  if (!count) return [];

  const ids = Array.from({ length: count }, (_, i) => i);
  const [raw, handles] = await Promise.all([
    Promise.all(ids.map((id) => publicClient.readContract({
      address, abi: marketAbi, functionName: "getMarket", args: [BigInt(id)],
    }) as Promise<RawMarket>)),
    Promise.all(ids.map((id) => publicClient.readContract({
      address, abi: marketAbi, functionName: "handleOf", args: [BigInt(id)],
    }) as Promise<string>)),
  ]);

  return ids.map((id) => shape(id, handles[id], raw[id]));
}

/** One market, when a page only needs the one it is showing. */
export async function readMarket(id: number): Promise<Market | null> {
  const address = marketAddress();
  if (!address) return null;
  try {
    const [raw, handle] = await Promise.all([
      publicClient.readContract({ address, abi: marketAbi, functionName: "getMarket", args: [BigInt(id)] }) as Promise<RawMarket>,
      publicClient.readContract({ address, abi: marketAbi, functionName: "handleOf", args: [BigInt(id)] }) as Promise<string>,
    ]);
    return shape(id, handle, raw);
  } catch {
    return null;
  }
}

/**
 * What one wallet is holding, across every market.
 *
 * Read straight off the contract rather than from an event index: the roster
 * is small enough that asking is cheaper than maintaining a copy that can be
 * wrong.
 */
export async function readPositions(owner: Address, markets?: Market[]): Promise<Position[]> {
  const address = marketAddress();
  if (!address) return [];
  const all = markets ?? (await readMarkets());
  if (!all.length) return [];

  const [stakes, claimedFlags, claimables] = await Promise.all([
    Promise.all(all.map((m) => publicClient.readContract({
      address, abi: marketAbi, functionName: "stakesOf", args: [BigInt(m.id), owner],
    }) as Promise<readonly [bigint, bigint]>)),
    Promise.all(all.map((m) => publicClient.readContract({
      address, abi: marketAbi, functionName: "claimed", args: [BigInt(m.id), owner],
    }) as Promise<boolean>)),
    Promise.all(all.map((m) => publicClient.readContract({
      address, abi: marketAbi, functionName: "claimable", args: [BigInt(m.id), owner],
    }) as Promise<readonly [bigint, bigint]>)),
  ]);

  const out: Position[] = [];
  all.forEach((m, i) => {
    const [up, down] = stakes[i];
    const claimed = claimedFlags[i];
    const owed = fromUnits(claimables[i][0]);

    for (const [side, units] of [["call", up], ["put", down]] as [Side, bigint][]) {
      const stake = fromUnits(units);
      if (stake <= 0) continue;
      out.push({
        marketId: m.id,
        owner,
        side,
        stake,
        // an open market marks at what it would pay; a settled one at what is
        // actually owed, which is zero for the side that lost
        markedAt: m.status === "open"
          ? stake * multiple(m.pools, side, stake)
          : (m.winner === side || m.status === "void" ? owed : 0),
        claimed,
        payout: m.status !== "open" && !claimed ? owed : undefined,
      });
    }
  });
  return out;
}

/** Live claim quote for one wallet in one market, straight from the contract. */
export async function readClaimable(id: number, owner: Address) {
  const address = marketAddress();
  if (!address) return { amount: 0, fee: 0 };
  const [amount, fee] = await publicClient.readContract({
    address, abi: marketAbi, functionName: "claimable", args: [BigInt(id), owner],
  }) as readonly [bigint, bigint];
  return { amount: fromUnits(amount), fee: fromUnits(fee) };
}
