import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * The snapshot record, served read-only. A settlement that commits the
 * hash of a file nobody can fetch proves nothing, so the files are public.
 */
export async function GET(req: Request) {
  const { snaps } = await ready();
  const url = new URL(req.url);
  const handle = url.searchParams.get("handle");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 288), 2016);

  const out = snaps.slice(-limit).map((s) =>
    handle ? { t: s.t, source: s.source, pnl: { [handle]: s.pnl[handle] } } : s,
  );
  return NextResponse.json({ count: out.length, snapshots: out });
}
