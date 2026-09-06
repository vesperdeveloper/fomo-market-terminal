#!/usr/bin/env node
/**
 * One-off historical backfill.
 *
 * Opens each listed trader's fomo profile so the app issues its own
 * authenticated request for that account's PnL series, reads the responses
 * as they go past, and pushes the points to the deployed app. Run it once;
 * the 5-minute keeper extends the record from there.
 *
 *   node scripts/history.mjs [count]
 */
import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = process.env.KEEPER_PROFILE ?? join(homedir(), ".fomomarket-keeper-profile");
const TARGET  = process.env.KEEPER_TARGET  ?? "https://fomo-market.vercel.app";
const SECRET  = process.env.KEEPER_SECRET  ?? "";
const HANDLE  = process.env.FOMO_HANDLE    ?? "TameZestyLlama";
const COUNT   = Number(process.argv[2] ?? 10);

if (!SECRET) { console.error("KEEPER_SECRET is not set"); process.exit(1); }

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1400, height: 1000 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

let board = [];
let points = [];               // accumulates across the ranges the app requests
page.on("response", async (res) => {
  const url = res.url();
  if (/\/v2\/leaderboard(\?|$)/.test(url)) {
    try {
      const j = await res.json();
      const l = j?.responseObject?.leaderboard;
      if (Array.isArray(l)) board = l;
    } catch {}
    return;
  }
  if (!/aggregatedSnapshot/.test(url)) return;
  try {
    const j = await res.json();
    const arr = j?.responseObject;
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      if (typeof p?.pnl !== "number" || !p?.snapshotId) continue;
      points.push({ t: new Date(p.snapshotId * 1000).toISOString(), pnl: p.pnl });
    }
  } catch {}
});

console.log("loading the board...");
await page.goto(`https://fomo.family/profile/${HANDLE}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
for (let i = 0; i < 30 && !board.length; i++) await page.waitForTimeout(1000);
if (!board.length) { console.error("no leaderboard captured - run: npm run keeper:login"); await ctx.close(); process.exit(2); }

const targets = board.slice(0, COUNT).map(u => ({ handle: u.userHandle, name: u.displayName }));
console.log(`backfilling ${targets.length} traders\n`);

const series = [];
for (const t of targets) {
  points = [];
  await page.goto(`https://fomo.family/profile/${t.handle}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  // let the app request its default range, then widen it
  for (let i = 0; i < 14 && points.length < 20; i++) await page.waitForTimeout(1000);
  for (const label of ["30D", "ALL", "7D"]) {
    try {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.count()) { await el.click({ timeout: 3000 }); await page.waitForTimeout(2500); }
    } catch {}
  }
  // de-duplicate by timestamp, keep the densest reading per moment
  const byT = new Map();
  for (const p of points) byT.set(p.t, p.pnl);
  const pts = [...byT.entries()].map(([t, pnl]) => ({ t, pnl })).sort((a,b)=>a.t<b.t?-1:1);
  console.log(`  @${t.handle.padEnd(18)} ${String(pts.length).padStart(4)} points` +
    (pts.length ? `  ${pts[0].t.slice(0,10)} .. ${pts[pts.length-1].t.slice(0,10)}` : ""));
  if (pts.length) series.push({ handle: t.handle, points: pts });
}

if (!series.length) { console.error("\nnothing captured"); await ctx.close(); process.exit(3); }

const res = await fetch(`${TARGET}/api/keeper/history`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
  body: JSON.stringify({ series }),
});
const out = await res.json().catch(()=>({}));
console.log("\npushed:", res.status, JSON.stringify(out.written ?? out).slice(0, 400));
await ctx.close();
