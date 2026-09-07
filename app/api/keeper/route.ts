import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { adapter, ready, isOptedOut } from "@/lib/runtime";
import { settleDue, ensureMarkets, ROSTER_SIZE } from "@/lib/markets";

export const dynamic = "force-dynamic";

/** One read, one snapshot file. Wire to a 5-minute cron. */
export async function GET() {
  await ready();
  const store = getStore();
  const a = adapter();

  let recorded: string | null = null;
  let error: string | null = null;

  try {
    const { snapshot, traders } = await a.read();
    await store.appendSnapshot(snapshot);
    if (traders.length) await store.putTraders(traders);
    recorded = snapshot.t;
  } catch (e) {
    // a failed read is recorded as a gap, not smoothed over
    error = e instanceof Error ? e.message : String(e);
  }

  const snaps = await store.listSnapshots();
  const traders = await store.getTraders();
  await ensureMarkets(store, traders.slice(0, ROSTER_SIZE), snaps);
  const settled = await settleDue(store, snaps, new Set(traders.filter(t => isOptedOut(t.handle)).map(t => t.handle)));

  return NextResponse.json({
    source: a.name, recorded, error,
    snapshots: snaps.length, settled: settled.length,
  });
}
