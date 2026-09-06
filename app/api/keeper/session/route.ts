import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The reader's refresh token.
 *
 * It rotates every time it is used, so it cannot live in an environment
 * variable — whoever refreshes has to hand the next one back. Both ends of
 * this endpoint are behind the keeper secret, and the token itself never
 * reaches a browser.
 */
function guard(req: Request) {
  const secret = process.env.KEEPER_SECRET;
  if (!secret) return "keeper secret is not configured";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return given === secret ? null : "unauthorized";
}

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return NextResponse.json({ error: bad }, { status: 401 });
  const token = await getStore().getSession();
  return NextResponse.json({ refresh_token: token });
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return NextResponse.json({ error: bad }, { status: 401 });
  const { refresh_token: token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || token.length < 20) {
    return NextResponse.json({ error: "refresh_token required" }, { status: 400 });
  }
  await getStore().putSession(token);
  return NextResponse.json({ ok: true });
}
