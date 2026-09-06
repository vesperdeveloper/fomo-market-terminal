import { Client } from 'pg';
import fs from 'fs';
const url = fs.readFileSync(new URL('../.env.local', import.meta.url).pathname,'utf8')
  .match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const c = new Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(
  `SELECT id, owner, market_id, side, shares, cost, deposit_tx, claimed_at FROM positions ORDER BY created_at`);
const paid = rows.filter(r => r.deposit_tx);
const paper = rows.filter(r => !r.deposit_tx && !r.claimed_at);
console.log('positions total          :', rows.length);
console.log('backed by a real payment :', paid.length);
console.log('paper, still open        :', paper.length,
            '-> shares', paper.reduce((s,r)=>s+Number(r.shares),0).toFixed(2));
console.log();
for (const r of paper.slice(0,10))
  console.log('  ', r.id.padEnd(28), r.owner.slice(0,14).padEnd(16), r.side, Number(r.shares).toFixed(2));
await c.end();
