import { Pool, type PoolClient } from "pg";
import type { Market, Position, Side, Snapshot, Trader } from "./types";
import type { Store } from "./store";
import { quoteBuy, quoteSell } from "./amm";

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,                       // serverless: keep the footprint small
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

let ready: Promise<void> | null = null;
export function migrate(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await db().query(`
      CREATE TABLE IF NOT EXISTS snapshots (
        t       timestamptz NOT NULL,
        source  text        NOT NULL,
        pnl     jsonb       NOT NULL,
        PRIMARY KEY (t, source)
      );
      CREATE INDEX IF NOT EXISTS snapshots_t_idx ON snapshots (t DESC);

      CREATE TABLE IF NOT EXISTS history (
        handle text        NOT NULL,
        t      timestamptz NOT NULL,
        pnl    double precision NOT NULL,
        PRIMARY KEY (handle, t)
      );
      CREATE INDEX IF NOT EXISTS history_handle_t_idx ON history (handle, t ASC);

      CREATE TABLE IF NOT EXISTS traders (
        handle    text PRIMARY KEY,
        name      text NOT NULL,
        bio       text,
        followers integer NOT NULL DEFAULT 0,
        avatar    text,
        banner    text,
        fomo_id   text,
        rank      integer NOT NULL DEFAULT 0
      );
      ALTER TABLE traders ADD COLUMN IF NOT EXISTS fomo_id text;

      CREATE TABLE IF NOT EXISTS markets (
        id           integer PRIMARY KEY,
        handle       text        NOT NULL,
        "window"     text        NOT NULL,
        opens_at     timestamptz NOT NULL,
        closes_at    timestamptz NOT NULL,
        status       text        NOT NULL,
        strike       double precision,
        settle_value double precision,
        winner       text,
        void_reason  text,
        reserve_call double precision NOT NULL,
        reserve_put  double precision NOT NULL,
        volume       double precision NOT NULL DEFAULT 0,
        seed         double precision NOT NULL
      );
      CREATE INDEX IF NOT EXISTS markets_handle_idx ON markets (handle, status);

      CREATE TABLE IF NOT EXISTS positions (
        id         text PRIMARY KEY,
        owner      text        NOT NULL,
        market_id  integer     NOT NULL REFERENCES markets(id),
        side       text        NOT NULL,
        shares     double precision NOT NULL,
        cost       double precision NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        payout     double precision
      );
      CREATE INDEX IF NOT EXISTS positions_owner_idx ON positions (owner);

      ALTER TABLE positions ADD COLUMN IF NOT EXISTS deposit_tx text;
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS payout_tx  text;

      -- One payment, one ticket. The primary key is what actually enforces
      -- this: two requests replaying the same transfer race to insert the
      -- same row and exactly one of them wins, which an application-level
      -- "have I seen this?" check could not guarantee.
      -- The reader's refresh token. It rotates on use, so it cannot live in
      -- an environment variable: whoever refreshes has to write the next one
      -- back somewhere both the reader and the site can reach.
      CREATE TABLE IF NOT EXISTS keeper_session (
        id            integer PRIMARY KEY,
        refresh_token text NOT NULL,
        updated_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS spent_tx (
        hash    text PRIMARY KEY,
        spent_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  })();
  return ready;
}

const toMarket = (r: any): Market => ({
  id: r.id, handle: r.handle, window: r.window,
  opensAt: new Date(r.opens_at).toISOString(),
  closesAt: new Date(r.closes_at).toISOString(),
  status: r.status, strike: r.strike, settleValue: r.settle_value,
  winner: r.winner, voidReason: r.void_reason,
  reserves: { call: r.reserve_call, put: r.reserve_put },
  volume: r.volume, seed: r.seed,
});

const toPosition = (r: any): Position => ({
  id: r.id, owner: r.owner, marketId: r.market_id, side: r.side,
  shares: r.shares, cost: r.cost,
  createdAt: new Date(r.created_at).toISOString(),
  claimedAt: r.claimed_at ? new Date(r.claimed_at).toISOString() : undefined,
  payout: r.payout ?? undefined,
  depositTx: r.deposit_tx ?? undefined,
  payoutTx: r.payout_tx ?? undefined,
});

export const postgresStore: Store = {
  async appendSnapshot(s) {
    await migrate();
    await db().query(
      `INSERT INTO snapshots (t, source, pnl) VALUES ($1, $2, $3)
       ON CONFLICT (t, source) DO NOTHING`,
      [s.t, s.source, JSON.stringify(s.pnl)],
    );
    // Nothing ever settles on a reading older than the longest window plus
    // the age tolerance, and the memory store has always dropped them. This
    // one never did, so the table grew without bound — and since every read
    // is a window over it, an unbounded table is unbounded egress.
    await db().query(`DELETE FROM snapshots WHERE t < now() - interval '10 days'`);
  },

  async listSnapshots(sinceMs) {
    await migrate();
    // a 7d window plus the age tolerance is the furthest anything reaches back
    const since = new Date(sinceMs ?? Date.now() - 9 * 864e5).toISOString();
    const { rows } = await db().query(
      `SELECT t, source, pnl FROM snapshots WHERE t >= $1 ORDER BY t ASC`, [since],
    );
    return rows.map((r): Snapshot => ({
      t: new Date(r.t).toISOString(), source: r.source, pnl: r.pnl,
    }));
  },

  async latestSnapshot() {
    await migrate();
    const { rows } = await db().query(
      `SELECT t, source, pnl FROM snapshots ORDER BY t DESC LIMIT 1`,
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { t: new Date(r.t).toISOString(), source: r.source, pnl: r.pnl };
  },

  async getTraders() {
    await migrate();
    const { rows } = await db().query(`SELECT * FROM traders ORDER BY rank ASC`);
    return rows.map((r): Trader => ({
      handle: r.handle, name: r.name, bio: r.bio ?? undefined,
      followers: r.followers, avatar: r.avatar ?? undefined, banner: r.banner ?? undefined,
      fomoId: r.fomo_id ?? undefined,
    } as Trader));
  },

  async putTraders(list) {
    await migrate();
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        await c.query(
          `INSERT INTO traders (handle, name, bio, followers, avatar, banner, rank, fomo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (handle) DO UPDATE SET
             name = EXCLUDED.name,
             bio = COALESCE(EXCLUDED.bio, traders.bio),
             followers = EXCLUDED.followers,
             avatar = COALESCE(EXCLUDED.avatar, traders.avatar),
             banner = COALESCE(EXCLUDED.banner, traders.banner),
             rank = EXCLUDED.rank,
             fomo_id = COALESCE(EXCLUDED.fomo_id, traders.fomo_id)`,
          [t.handle, t.name, t.bio ?? null, t.followers, t.avatar ?? null, t.banner ?? null, i,
           (t as any).fomoId ?? null],
        );
      }
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  },

  async getSession() {
    await migrate();
    const { rows } = await db().query(`SELECT refresh_token FROM keeper_session WHERE id = 1`);
    return rows.length ? (rows[0].refresh_token as string) : null;
  },

  async putSession(refreshToken) {
    await migrate();
    await db().query(
      `INSERT INTO keeper_session (id, refresh_token, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = now()`,
      [refreshToken],
    );
  },

  async getMarkets() {
    await migrate();
    const { rows } = await db().query(`SELECT * FROM markets ORDER BY id ASC`);
    return rows.map(toMarket);
  },

  async putMarket(m) {
    await migrate();
    await db().query(
      `INSERT INTO markets (id, handle, "window", opens_at, closes_at, status, strike,
                            settle_value, winner, void_reason, reserve_call, reserve_put, volume, seed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, strike = EXCLUDED.strike,
         settle_value = EXCLUDED.settle_value, winner = EXCLUDED.winner,
         void_reason = EXCLUDED.void_reason, reserve_call = EXCLUDED.reserve_call,
         reserve_put = EXCLUDED.reserve_put, volume = EXCLUDED.volume`,
      [m.id, m.handle, m.window, m.opensAt, m.closesAt, m.status, m.strike,
       m.settleValue, m.winner, m.voidReason, m.reserves.call, m.reserves.put, m.volume, m.seed],
    );
  },

  async getPositions(owner) {
    await migrate();
    const { rows } = owner
      ? await db().query(`SELECT * FROM positions WHERE owner = $1 ORDER BY created_at ASC`, [owner])
      : await db().query(`SELECT * FROM positions ORDER BY created_at ASC`);
    return rows.map(toPosition);
  },

  async putPosition(p) {
    await migrate();
    await db().query(
      `INSERT INTO positions (id, owner, market_id, side, shares, cost, created_at, claimed_at, payout, deposit_tx, payout_tx)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         shares = EXCLUDED.shares, cost = EXCLUDED.cost,
         claimed_at = EXCLUDED.claimed_at, payout = EXCLUDED.payout,
         payout_tx = EXCLUDED.payout_tx`,
      [p.id, p.owner, p.marketId, p.side, p.shares, p.cost,
       p.createdAt, p.claimedAt ?? null, p.payout ?? null,
       p.depositTx ?? null, p.payoutTx ?? null],
    );
  },

  async claimDepositTx(hash) {
    await migrate();
    const { rowCount } = await db().query(
      `INSERT INTO spent_tx (hash) VALUES ($1) ON CONFLICT (hash) DO NOTHING`,
      [hash.toLowerCase()],
    );
    return rowCount === 1;
  },
};

/** Historical PnL points, oldest first. */
export async function getHistory(handle: string, sinceMs?: number) {
  await migrate();
  const { rows } = sinceMs
    ? await db().query(
        `SELECT t, pnl FROM history WHERE handle=$1 AND t >= $2 ORDER BY t ASC`,
        [handle, new Date(sinceMs).toISOString()])
    : await db().query(`SELECT t, pnl FROM history WHERE handle=$1 ORDER BY t ASC`, [handle]);
  return rows.map((r) => ({ t: new Date(r.t).toISOString(), pnl: r.pnl as number }));
}

/**
 * History for several handles at once.
 *
 * The board used to ask for this one handle at a time, which is a round trip
 * per row: with a hundred accounts in the record that was a hundred queries
 * on every page render, and most of the second the page took to draw.
 */
export async function getHistoryMany(handles: string[], sinceMs?: number) {
  if (!handles.length) return {} as Record<string, { t: string; pnl: number }[]>;
  await migrate();
  const { rows } = sinceMs
    ? await db().query(
        `SELECT handle, t, pnl FROM history WHERE handle = ANY($1) AND t >= $2 ORDER BY handle, t ASC`,
        [handles, new Date(sinceMs).toISOString()])
    : await db().query(
        `SELECT handle, t, pnl FROM history WHERE handle = ANY($1) ORDER BY handle, t ASC`,
        [handles]);
  const out: Record<string, { t: string; pnl: number }[]> = {};
  for (const r of rows) {
    (out[r.handle] ??= []).push({ t: new Date(r.t).toISOString(), pnl: r.pnl as number });
  }
  return out;
}

/** Handles that have fewer than `min` points on record. */
export async function handlesMissingHistory(handles: string[], min = 24) {
  if (!handles.length) return [];
  await migrate();
  const { rows } = await db().query(
    `SELECT h AS handle, coalesce(c.n, 0)::int AS n
       FROM unnest($1::text[]) h
       LEFT JOIN (SELECT handle, count(*) n FROM history GROUP BY handle) c ON c.handle = h
      WHERE coalesce(c.n, 0) < $2`,
    [handles, min]);
  return rows.map((r) => r.handle as string);
}

/**
 * Write a handle's history in one statement.
 *
 * A backfill is a hundred-odd points; inserting them one at a time is a
 * hundred round trips to a database three thousand miles away, which is long
 * enough for a serverless function to give up halfway through.
 */
export async function putHistory(handle: string, points: { t: string; pnl: number }[]) {
  if (!points.length) return 0;
  await migrate();
  await db().query(
    `INSERT INTO history (handle, t, pnl)
     SELECT $1, t::timestamptz, pnl::double precision
       FROM unnest($2::text[], $3::double precision[]) AS s(t, pnl)
     ON CONFLICT (handle, t) DO UPDATE SET pnl = EXCLUDED.pnl`,
    [handle, points.map((p) => p.t), points.map((p) => p.pnl)],
  );
  return points.length;
}

/** Every handle that has history, with its point count. */
export async function historyCoverage() {
  await migrate();
  const { rows } = await db().query(
    `SELECT handle, count(*)::int n, min(t) f, max(t) l FROM history GROUP BY handle`);
  return rows.map((r) => ({ handle: r.handle, n: r.n,
    from: new Date(r.f).toISOString(), to: new Date(r.l).toISOString() }));
}

/**
 * Buy inside a transaction.
 *
 * The reserve update is a read-modify-write on shared state, so it cannot be
 * done as a plain read followed by a plain write: two buys landing together
 * would both price off the same starting reserves and the second would
 * overwrite the first, breaking the invariant and minting collateral that
 * was never deposited. The row is locked for the duration instead.
 */
export async function tradeAtomic(
  marketId: number, side: Side, amount: number, owner: string,
  depositTx?: string,
): Promise<{ position: Position; avgPrice: number; priceAfter: number }> {
  await migrate();
  const c: PoolClient = await db().connect();
  try {
    await c.query("BEGIN");

    // Spending the payment happens in the same transaction that hands out
    // the shares, so a replayed hash cannot buy a second ticket even if two
    // requests arrive at the same instant: one insert wins, the other rolls
    // the whole trade back.
    if (depositTx) {
      const claim = await c.query(
        `INSERT INTO spent_tx (hash) VALUES ($1) ON CONFLICT (hash) DO NOTHING`,
        [depositTx.toLowerCase()],
      );
      if (claim.rowCount !== 1) throw new Error("that payment has already been used");
    }

    const { rows } = await c.query(`SELECT * FROM markets WHERE id = $1 FOR UPDATE`, [marketId]);
    if (!rows.length) throw new Error("no such market");
    const m = toMarket(rows[0]);
    if (m.status !== "open") throw new Error(`market is ${m.status}`);

    const q = quoteBuy(m.reserves, side, amount);
    const slip = Math.abs(q.avgPrice - q.priceBefore);
    if (slip > 0.05) throw new Error("size too large for current depth");

    await c.query(
      `UPDATE markets SET reserve_call = $1, reserve_put = $2, volume = volume + $3 WHERE id = $4`,
      [q.reserves.call, q.reserves.put, amount, marketId],
    );

    const id = `${marketId}-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await c.query(
      `INSERT INTO positions (id, owner, market_id, side, shares, cost, deposit_tx)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, owner, marketId, side, q.shares, amount, depositTx ?? null],
    );

    await c.query("COMMIT");
    return {
      position: {
        id, owner, marketId, side, shares: q.shares, cost: amount,
        createdAt: new Date().toISOString(), depositTx,
      },
      avgPrice: q.avgPrice,
      priceAfter: q.priceAfter,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
