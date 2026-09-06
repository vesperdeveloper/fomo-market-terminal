import { NextResponse } from "next/server";
import { syncMarkets } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The tick that keeps the contract in step with the record: open what is
 * missing, settle what is due. Behind a secret because it spends gas, not
 * because what it does is private — everything it writes is on chain.
 */
async function run(req: Request) {
  const secret = process.env.KEEPER_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.replace(/^Bearer\s+/i, "");
  // Vercel signs its own cron calls; a manual run carries the keeper secret
  const fromCron = req.headers.get("x-vercel-cron") !== null;
  if (secret && given !== secret && !fromCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncMarkets());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
