import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { ready, isOptedOut } from "@/lib/runtime";
import { ensureMarkets, settleDue, ROSTER_SIZE } from "@/lib/markets";
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
    | { source?: string; t?: string; rows?: { handle: string; pnl: string | number; name?: string; followers?: number; avatar?: string; banner?: string; bio?: string; fomoId?: string }[] }
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
      // fomo's own id for the account, which is what its history is keyed on
      fomoId: r.fomoId,
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
  await ensureMarkets(store, traders.slice(0, ROSTER_SIZE), snaps);
  const settled = await settleDue(
    store, snaps,
    new Set(traders.filter((t) => isOptedOut(t.handle)).map((t) => t.handle)),
  );

  /**
   * Which of the accounts about to be listed have no past to draw.
   *
   * The roster follows the leaderboard, so handles rotate in that this
   * record has never seen. Until one has a history the interface can only
   * say it moved by nothing, which is a lie of omission — so the reader is
   * told to go and fetch it, a couple of handles per tick.
   */
  let needHistory: string[] = [];
  try {
    const { handlesMissingHistory } = await import("@/lib/store-postgres");
    const listed = (await store.getTraders()).slice(0, ROSTER_SIZE).map((t) => t.handle);
    needHistory = (await handlesMissingHistory(listed)).slice(0, 2);
  } catch { needHistory = []; }

  return NextResponse.json({
    accepted: Object.keys(pnl).length, rejected,
    at: snapshot.t, snapshots: snaps.length, settled: settled.length,
    needHistory,
  });
}
