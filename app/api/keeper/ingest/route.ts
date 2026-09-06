import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { ready } from "@/lib/runtime";
import { parseExactUsd } from "@/lib/settlement";
import type { Snapshot, Trader } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Accepts a snapshot pushed by a keeper running somewhere else.
 *
 * This exists so the credential that can read the source never has to live
 * on this server: the keeper holds the session on a machine its owner
 * controls and posts only the reading it took.
 */
export async function POST(req: Request) {
  const secret = process.env.KEEPER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "ingest disabled: KEEPER_SECRET unset" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as
    | { source?: string; t?: string; rows?: { handle: string; pnl: string | number; name?: string; followers?: number; avatar?: string; banner?: string; bio?: string }[] }
    | null;

  if (!body?.rows?.length) {
    return NextResponse.json({ error: "rows required" }, { status: 400 });
  }

  const pnl: Record<string, number> = {};
  const traders: Trader[] = [];
  const rejected: string[] = [];

  for (const r of body.rows) {
    if (!r?.handle) continue;
    // the same precision rule the local parser uses: a rounded figure
    // cannot settle a market, so the row is dropped rather than trusted
    const exact = typeof r.pnl === "number" ? r.pnl : parseExactUsd(String(r.pnl));
    if (exact === null || !Number.isFinite(exact)) { rejected.push(r.handle); continue; }
    pnl[r.handle] = exact;
    traders.push({
      handle: r.handle,
      name: r.name ?? r.handle,
      followers: Number(r.followers ?? 0),
      avatar: r.avatar,
      banner: r.banner,
      bio: r.bio,
    });
  }

  if (!Object.keys(pnl).length) {
    return NextResponse.json({ error: "no usable rows", rejected }, { status: 422 });
  }

  const snapshot: Snapshot = {
    t: body.t ?? new Date().toISOString(),
    source: body.source ?? "keeper:push",
    pnl,
  };

  await ready();
  const store = getStore();
  await store.appendSnapshot(snapshot);
  await store.putTraders(traders);

  const snaps = await store.listSnapshots();

  // markets are opened and settled by the oracle against the contract, not
  // here: a reading is evidence, and evidence does not move money by itself
  return NextResponse.json({
    accepted: Object.keys(pnl).length, rejected,
    at: snapshot.t, snapshots: snaps.length,
  });
}
