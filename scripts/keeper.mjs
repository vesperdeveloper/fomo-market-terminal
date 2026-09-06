#!/usr/bin/env node
/**
 * Local keeper.
 *
 * Holds a fomo session in a browser profile on THIS machine and pushes
 * readings to the deployed app. The session never leaves here: only handles
 * and numbers are sent onward, never the token that fetched them.
 *
 * It does not call fomo's API itself. The page is loaded and the app makes
 * its own authenticated requests; the keeper reads the responses as they go
 * past. That way the Privy JWT is never handled, copied or stored here.
 *
 *   node scripts/keeper.mjs --login   # one-time, sign in by hand
 *   node scripts/keeper.mjs --once    # single reading
 *   node scripts/keeper.mjs           # every 5 minutes
 *
 * NOTE: fomo's web app does not boot in headless Chromium - it renders an
 * empty shell. The browser therefore runs headed and needs a session that
 * stays awake.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE  = process.env.KEEPER_PROFILE ?? join(homedir(), ".fomomarket-keeper-profile");
const TARGET   = process.env.KEEPER_TARGET  ?? "https://fomo-market.vercel.app";
const SECRET   = process.env.KEEPER_SECRET  ?? "";
const HANDLE   = process.env.FOMO_HANDLE    ?? "TameZestyLlama";
const PAGE_URL = `https://fomo.family/profile/${HANDLE}`;
const EVERY_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 5 * 60 * 1000);
const LOGIN    = process.argv.includes("--login");
const ONCE     = process.argv.includes("--once");

mkdirSync(PROFILE, { recursive: true });

/** The cumulative figure every market settles on lives on this endpoint. */
const isTotalBoard = (u) => /\/v2\/leaderboard(\?|$)/.test(u);

function rowsFrom(payload) {
  const list = payload?.responseObject?.leaderboard;
  if (!Array.isArray(list)) return [];
  return list
    .map((u) => ({
      handle: u.userHandle,
      // full float precision straight off the wire - never a rounded string
      pnl: u.totalPnL,
      name: u.displayName ?? u.userHandle,
      followers: u.followers ?? 0,
      avatar: u.profilePictureLink ?? undefined,
      // the leaderboard rows carry no cover photo today; the other spellings
      // are here so one shows up the moment fomo sends it
      banner: u.coverPhotoLink ?? u.coverPhoto ?? u.bannerLink ?? u.bannerPhotoLink ?? undefined,
      bio: u.description ?? undefined,
    }))
    .filter((r) => r.handle && typeof r.pnl === "number" && Number.isFinite(r.pnl));
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,                       // the app will not render headless
    viewport: { width: 1400, height: 1000 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  let session = null, rows = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("auth.privy.io/api/v1/sessions")) {
      try { session = await res.json(); } catch {}
      return;
    }
    if (!isTotalBoard(url)) return;
    try { const r = rowsFrom(await res.json()); if (r.length) rows = r; } catch {}
  });

  if (LOGIN) {
    console.log(`\nOpening ${PAGE_URL} in a SEPARATE browser profile.`);
    console.log("Being signed in in your normal Chrome does not carry over: this");
    console.log("profile has its own cookie jar. fomo signs in through Privy.\n");
    console.log("Sign in, open the Leaderboard panel, THEN press Enter here.\n");
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await new Promise((r) => process.stdin.once("data", r));

    process.stdout.write("checking... ");
    rows = [];
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(12_000);

    if (!(session?.token || session?.privy_access_token)) {
      console.log("\nNOT SIGNED IN - Privy issued no session.");
      console.log("Run this again and finish the sign-in before pressing Enter.");
      await ctx.close(); process.exit(1);
    }
    console.log("signed in.");
    console.log(`  leaderboard rows seen: ${rows.length}`);
    if (rows.length) {
      console.log(`  top: @${rows[0].handle} totalPnL=${rows[0].pnl}`);
      console.log("\nReady. Start the loop with: npm run keeper");
    } else {
      console.log("  no leaderboard response was captured - open the Leaderboard");
      console.log("  panel on that page and run --login again.");
      await ctx.close(); process.exit(2);
    }
    await ctx.close();
    return;
  }

  if (!SECRET) {
    console.error("KEEPER_SECRET is not set - the deployed app will reject the push.");
    process.exit(1);
  }

  const tick = async () => {
    rows = [];
    const at = new Date().toISOString();
    try {
      await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch {
      console.warn(`${at}  navigation failed - recording nothing`);
      return;
    }
    // the app issues its own authenticated request shortly after boot
    for (let i = 0; i < 30 && !rows.length; i++) await page.waitForTimeout(1000);

    if (!rows.length) {
      console.warn(`${at}  no leaderboard response - session may have expired.`);
      console.warn(`          re-run: npm run keeper:login`);
      return;
    }

    const res = await fetch(`${TARGET}/api/keeper/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ t: at, source: "fomo.family/v2/leaderboard", rows }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));

    const body = await res.json().catch(() => ({}));
    console.log(
      res.ok
        ? `${at}  pushed ${body.accepted}/${rows.length} rows · ${body.snapshots} held · ${body.settled} settled`
        : `${at}  ingest refused ${res.status}: ${body.error ?? ""}`,
    );
  };

  await tick();
  if (ONCE) { await ctx.close(); return; }
  console.log(`Reading every ${EVERY_MS / 60000} min. Ctrl-C to stop.`);
  setInterval(tick, EVERY_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
