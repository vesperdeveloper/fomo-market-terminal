import { Pool } from "pg";
import type { Snapshot, Trader } from "./types";
import type { Store } from "./store";

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

      -- The reader's refresh token. It rotates on every use, so it cannot
      -- live in an environment variable: whoever refreshes has to write the
      -- next one back somewhere both the reader and the site can reach.
      CREATE TABLE IF NOT EXISTS keeper_session (
        id            integer PRIMARY KEY,
        refresh_token text NOT NULL,
        updated_at    timestamptz NOT NULL DEFAULT now()
      );
    `);
  })();
  return ready;
}

export const postgresStore: Store = {
  async appendSnapshot(s) {
    await migrate();
    await db().query(
      `INSERT INTO snapshots (t, source, pnl) VALUES ($1, $2, $3)
       ON CONFLICT (t, source) DO NOTHING`,
      [s.t, s.source, JSON.stringify(s.pnl)],
    );
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
    }));
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
           t.fomoId ?? null],
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

export async function putHistory(handle: string, points: { t: string; pnl: number }[]) {
  if (!points.length) return 0;
  await migrate();
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    for (const p of points) {
      await c.query(
        `INSERT INTO history (handle, t, pnl) VALUES ($1,$2,$3)
         ON CONFLICT (handle, t) DO UPDATE SET pnl = EXCLUDED.pnl`,
        [handle, p.t, p.pnl]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
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
