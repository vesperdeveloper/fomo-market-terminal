import { artifacts } from "./artifacts";
import {
  chain, marketAddress, oracleAccount, oracleWallet, publicClient,
  oracleGas, toUnits,
} from "./chain";
import { readMarkets, SECONDS_OF } from "./onchain";
import { resolve as resolveFromRecord, valueAt } from "./settlement";
import { ROSTER_SIZE, WINDOWS } from "./markets";
import { isOptedOut, ready } from "./runtime";
import type { Market } from "./types";

const abi = artifacts.FomoMarket.abi;

export interface OracleReport {
  ran: boolean;
  reason?: string;
  gas: number;
  opened: { handle: string; window: string; strike: number; tx: string }[];
  resolved: { id: number; settle: number; winner: string; tx: string }[];
  voided: { id: number; reason: string; tx: string }[];
  skipped: string[];
}

/**
 * Keep the contract in step with the record.
 *
 * Two jobs, and only two: open a market where the roster has none running,
 * and publish the closing number for one whose window is over. Every value
 * it writes comes out of the snapshot record through the same median rule the
 * docs describe — this function decides nothing on its own, which is the
 * point. Where the record cannot support a settlement it voids rather than
 * guessing, and a void refunds every stake at cost.
 *
 * Transactions go one at a time on purpose. Firing them in parallel races
 * the nonce, and a dropped market-open is a worse outcome than a slow tick.
 */
export async function syncMarkets(now = new Date()): Promise<OracleReport> {
  const report: OracleReport = {
    ran: false, gas: 0, opened: [], resolved: [], voided: [], skipped: [],
  };

  const address = marketAddress();
  const wallet = oracleWallet();
  const account = oracleAccount();
  if (!address) { report.reason = "no market contract configured"; return report; }
  if (!wallet || !account) { report.reason = "no oracle key configured"; return report; }

  report.gas = await oracleGas();
  if (report.gas <= 0) {
    report.reason = `oracle ${account.address} has no ETH for gas`;
    return report;
  }
  report.ran = true;

  const { store, snaps } = await ready();
  const traders = (await store.getTraders()).slice(0, ROSTER_SIZE);
  const onChain = await readMarkets();
  const nowMs = now.getTime();

  const write = async (functionName: string, args: unknown[]) => {
    const hash = await wallet.writeContract({
      address, abi, functionName, args, chain, account,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  /* ------------------------------------------------- settle what is due */
  for (const m of onChain) {
    if (m.status !== "open") continue;
    if (new Date(m.closesAt).getTime() > nowMs) continue;

    const r = resolveFromRecord(snaps, m.handle, m.opensAt, m.closesAt, {
      optedOut: isOptedOut(m.handle),
      now: nowMs,
    });

    try {
      if (r.kind === "void") {
        // evidence_gap is not final: the keeper may still catch up inside the
        // grace window, and a market voided early can never be un-voided
        if (r.reason === "evidence_gap") { report.skipped.push(`#${m.id} waiting on readings`); continue; }
        const tx = await write("voidMarket", [BigInt(m.id), r.reason]);
        report.voided.push({ id: m.id, reason: r.reason, tx });
      } else {
        const tx = await write("resolve", [BigInt(m.id), toUnits(r.settle)]);
        report.resolved.push({ id: m.id, settle: r.settle, winner: r.winner, tx });
      }
    } catch (e) {
      report.skipped.push(`#${m.id} ${(e as Error).message.split("\n")[0]}`);
    }
  }

  /* ------------------------------------------------- open what is missing */
  const live = (h: string, w: string) =>
    onChain.some((m: Market) =>
      m.handle === h && m.window === w && m.status === "open" &&
      new Date(m.closesAt).getTime() > nowMs);

  for (const t of traders) {
    if (isOptedOut(t.handle)) continue;
    for (const w of WINDOWS) {
      if (live(t.handle, w)) continue;

      // a market cannot be struck at a number the record does not support
      const at = valueAt(snaps, t.handle, now.toISOString());
      if (!at) { report.skipped.push(`${t.handle} ${w} has no strike yet`); continue; }

      const opensAt = Math.floor(nowMs / 1000);
      const closesAt = opensAt + SECONDS_OF[w];
      try {
        const tx = await write("openMarket", [
          t.handle, SECONDS_OF[w], BigInt(opensAt), BigInt(closesAt), toUnits(at.value),
        ]);
        report.opened.push({ handle: t.handle, window: w, strike: at.value, tx });
      } catch (e) {
        report.skipped.push(`${t.handle} ${w} ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }

  return report;
}
