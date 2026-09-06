import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { adapter, ready } from "@/lib/runtime";

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

  // opening and settling markets is the oracle's job, on its own schedule:
  // this endpoint only writes down what was read
  return NextResponse.json({ source: a.name, recorded, error, snapshots: snaps.length });
}
