import { NextResponse } from "next/server";
import { putHistory, historyCoverage } from "@/lib/store-postgres";
import { isDurable } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Historical PnL, backfilled once and then extended by the 5-minute readings. */
export async function POST(req: Request) {
  const secret = process.env.KEEPER_SECRET;
  if (!secret) return NextResponse.json({ error: "ingest disabled" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDurable()) return NextResponse.json({ error: "no database" }, { status: 503 });

  const body = await req.json().catch(() => null) as
    | { series?: { handle: string; points: { t: string; pnl: number }[] }[] } | null;
  if (!body?.series?.length) return NextResponse.json({ error: "series required" }, { status: 400 });

  const written: Record<string, number> = {};
  for (const s of body.series) {
    if (!s.handle || !Array.isArray(s.points)) continue;
    const clean = s.points
      .filter((p) => p && typeof p.pnl === "number" && Number.isFinite(p.pnl) && p.t)
      .map((p) => ({ t: new Date(p.t).toISOString(), pnl: p.pnl }));
    written[s.handle] = await putHistory(s.handle, clean);
  }
  return NextResponse.json({ written, coverage: await historyCoverage() });
}

export async function GET() {
  if (!isDurable()) return NextResponse.json({ coverage: [] });
  return NextResponse.json({ coverage: await historyCoverage() });
}
