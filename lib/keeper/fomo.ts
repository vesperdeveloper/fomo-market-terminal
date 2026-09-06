import type { KeeperAdapter, Reading } from "./types";
import type { Trader } from "../types";
import { parseExactUsd } from "../settlement";

/**
 * Reads the fomo leaderboard.
 *
 * fomo publishes no developer API and its leaderboard requires an
 * authenticated session, so this adapter cannot invent access it does not
 * have: it needs a session token supplied through FOMO_SESSION, obtained
 * by a human logging into their own fomo account. Without it, read()
 * throws and the keeper records an evidence gap rather than guessing.
 */
export class FomoAdapter implements KeeperAdapter {
  readonly name = "fomo.family/leaderboard";

  constructor(
    private session = process.env.FOMO_SESSION ?? "",
    private endpoint = process.env.FOMO_LEADERBOARD_URL ?? "https://fomo.family/leaderboard",
  ) {}

  get configured() { return this.session.length > 0; }

  async read(): Promise<Reading> {
    if (!this.configured) {
      throw new Error(
        "FOMO_SESSION is not set. The fomo leaderboard is behind a login; " +
        "supply a session from an account you control.",
      );
    }

    const res = await fetch(this.endpoint, {
      headers: {
        cookie: this.session,
        accept: "text/html,application/json",
        "user-agent": process.env.FOMO_UA ?? "Mozilla/5.0",
      },
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("fomo session rejected - it has expired or was revoked");
    }
    if (!res.ok) throw new Error(`fomo returned ${res.status}`);

    const body = await res.text();
    return this.parse(body);
  }

  /** Split out so the parser can be exercised against a saved fixture. */
  parse(body: string): Reading {
    const rows = extractRows(body);
    if (!rows.length) throw new Error("no rows parsed - the page shape changed");

    const pnl: Record<string, number> = {};
    const traders: Trader[] = [];

    for (const r of rows) {
      const exact = parseExactUsd(r.pnlRaw);
      // an abbreviated figure cannot settle a market, so the row is dropped
      // rather than recorded at a precision it does not have
      if (exact === null) continue;
      pnl[r.handle] = exact;
      traders.push({
        handle: r.handle,
        name: r.name ?? r.handle,
        followers: r.followers ?? 0,
        avatar: r.avatar,
      });
    }

    if (!Object.keys(pnl).length) {
      throw new Error("every row was abbreviated - refusing to record");
    }

    return {
      snapshot: { t: new Date().toISOString(), source: this.name, pnl },
      traders,
    };
  }
}

interface RawRow {
  handle: string; name?: string; pnlRaw: string;
  followers?: number; avatar?: string;
}

/**
 * Pulls rows out of whatever the endpoint returned. Tries JSON first,
 * since an authenticated fetch may hand back the data payload directly,
 * and falls back to scanning embedded JSON in an HTML document.
 */
function extractRows(body: string): RawRow[] {
  const trimmed = body.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return fromJson(JSON.parse(trimmed)); } catch { /* fall through */ }
  }

  const rows: RawRow[] = [];
  // Next.js style payloads embed the records as escaped JSON in the document
  const re = /"(?:username|handle|screen_name)"\s*:\s*"([A-Za-z0-9_]{1,20})"/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(body))) {
    const handle = m[1];
    if (seen.has(handle)) continue;
    seen.add(handle);
    const near = body.slice(m.index, m.index + 1200);
    const pnl = /"(?:total_pnl|totalPnl|pnl)"\s*:\s*(-?[0-9.]+)/.exec(near);
    if (!pnl) continue;
    rows.push({
      handle,
      name: /"(?:display_name|name)"\s*:\s*"([^"]{0,64})"/.exec(near)?.[1],
      pnlRaw: pnl[1],
      followers: Number(/"(?:followers|follower_count)"\s*:\s*(\d+)/.exec(near)?.[1] ?? 0),
      avatar: /"(?:avatar|profile_image_url|image)"\s*:\s*"(https:[^"]+)"/.exec(near)?.[1]
        ?.replace(/\\\//g, "/"),
    });
  }
  return rows;
}

function fromJson(data: any): RawRow[] {
  const list = Array.isArray(data) ? data
    : data.leaderboard ?? data.traders ?? data.data ?? data.results ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((x: any) => ({
    handle: x.username ?? x.handle ?? x.screen_name,
    name: x.display_name ?? x.name,
    pnlRaw: String(x.total_pnl ?? x.totalPnl ?? x.pnl ?? ""),
    followers: Number(x.followers ?? x.follower_count ?? 0),
    avatar: x.avatar ?? x.profile_image_url ?? x.image,
  })).filter((r: RawRow) => r.handle && r.pnlRaw);
}
