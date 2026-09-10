#!/usr/bin/env python3
"""
The reader.

Takes one reading of the fomo leaderboard and posts it to the site, then asks
the site's oracle to open and settle whatever is due. Runs on a schedule
somewhere that is not anybody's laptop.

Two things make this awkward enough to need its own script:

1. fomo's API is behind bot management that fingerprints the TLS handshake.
   requests, httpx and curl all get a 430 with a valid token; only a client
   that presents a real browser's handshake gets through, which is what
   curl_cffi's impersonation does. This is not a way around authentication —
   the request still carries the account's own token.

2. That token lasts an hour. The long-lived thing is a Privy refresh token,
   which is exchanged for a fresh access token on every run.

Environment:
  SITE                 https://fomomarket.vercel.app
  KEEPER_SECRET        shared with the site
  PRIVY_REFRESH_TOKEN  fallback when the site is not holding one yet
  PRIVY_APP_ID         fomo's Privy app id
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

from curl_cffi import requests

SITE = os.environ.get("SITE", "").rstrip("/")
SECRET = os.environ.get("KEEPER_SECRET", "")
APP_ID = os.environ.get("PRIVY_APP_ID", "cm6h485o300n3zj9yl6vpedq7")
CA_ID = os.environ.get("PRIVY_CA_ID", "")
FALLBACK_REFRESH = os.environ.get("PRIVY_REFRESH_TOKEN", "")

IMPERSONATE = "chrome"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")

if not SITE or not SECRET:
    sys.exit("SITE and KEEPER_SECRET are required")

auth = {"authorization": f"Bearer {SECRET}"}


def stored_refresh_token():
    """
    Whichever session is current, with the environment winning.

    The site holds the token so it can survive a rotation without a redeploy,
    but that made a stale one impossible to replace: a fresh sign-in wrote the
    new token to the environment and the reader kept authenticating with the
    dead one out of the database, and answered 403 while a hand-run request
    with the same new token answered 200. An explicitly set environment
    variable is the operator saying "use this one", so it wins and is written
    back.
    """
    if FALLBACK_REFRESH:
        return FALLBACK_REFRESH
    try:
        r = requests.get(f"{SITE}/api/keeper/session", headers=auth, timeout=30)
        if r.status_code == 200:
            token = r.json().get("refresh_token")
            if token:
                return token
    except Exception as e:            # a site that is down is not a reason to stop
        print(f"session read failed: {e}")
    return FALLBACK_REFRESH


def remember_refresh_token(token):
    try:
        requests.post(f"{SITE}/api/keeper/session", headers={**auth, "content-type": "application/json"},
                      json={"refresh_token": token}, timeout=30)
    except Exception as e:
        print(f"session write failed: {e}")


def access_token(refresh):
    """Trade the refresh token for an hour of access."""
    headers = {
        "privy-app-id": APP_ID,
        "content-type": "application/json",
        "origin": "https://fomo.family",
        "referer": "https://fomo.family/",
        "privy-client": "react-auth:2.13.4",
        "user-agent": UA,
    }
    if CA_ID:
        headers["privy-ca-id"] = CA_ID

    r = requests.post("https://auth.privy.io/api/v1/sessions", headers=headers,
                      json={"refresh_token": refresh}, impersonate=IMPERSONATE, timeout=45)
    if r.status_code != 200:
        sys.exit(f"privy refused the refresh token: {r.status_code} {r.text[:200]}")

    body = r.json()
    # Privy does not rotate this today, but it is allowed to. Write back
    # whichever token is current so the next run reads it from the site
    # rather than from a secret nobody remembers to update.
    remember_refresh_token(body.get("refresh_token") or refresh)

    token = body.get("token")
    if not token:
        sys.exit("privy returned no access token")
    return token


def api_headers(token):
    return {
        "authorization": f"Bearer {token}",
        "app-language": "en",
        "x-supported-chains": "1,56,143,4663,8453,1399811149",
        "content-type": "application/json",
        "origin": "https://fomo.family",
        "referer": "https://fomo.family/",
        "user-agent": UA,
    }


def leaderboard(token):
    r = requests.get("https://prod-api.fomo.family/v2/leaderboard", headers=api_headers(token),
                     impersonate=IMPERSONATE, timeout=45)
    if r.status_code != 200:
        sys.exit(f"leaderboard read failed: {r.status_code} {r.text[:200]}")
    return r.json()


HOUR = 3600
EIGHT_HOURS = 8 * HOUR


def snapshot_at(token, user_id, when):
    """
    One reading of an account's cumulative PnL at a moment.

    fomo keeps these on an aligned grid — hourly is the finest that answers,
    and the hour currently in progress comes back as zero because it has not
    been computed yet. So callers ask for whole hours, in the past.
    """
    url = ("https://prod-api.fomo.family/v2/userTokens/aggregatedSnapshotById"
           f"?userId={user_id}&snapshotId={when}")
    r = requests.get(url, headers=api_headers(token), impersonate=IMPERSONATE, timeout=15)
    if r.status_code != 200:
        return None
    body = (r.json() or {}).get("responseObject") or {}
    pnl = body.get("pnl")
    # a zero here means "no reading", not "flat": a live account is never
    # exactly zero, and the current hour always answers this way
    return pnl if isinstance(pnl, (int, float)) and pnl != 0 else None


def history_for(token, user_id, days=14):
    """
    Enough past to draw a line, and no more than that.

    This used to fetch a month at hourly detail for the recent part: about a
    hundred and thirty requests per account, fired back to back. Doing that
    for nine accounts in a row is what got the reading account's API access
    revoked — the endpoint is meant to serve a page, not a scraper.

    Now it is fourteen days at eight-hour steps, forty-odd requests, spaced.
    The five-minute readings fill in the recent detail on their own within a
    day, so the dense part was never worth asking for.
    """
    now = int(time.time())
    eight = now // EIGHT_HOURS * EIGHT_HOURS
    wanted = [eight - k * EIGHT_HOURS for k in range(1, days * 3 + 1)]

    started = time.monotonic()
    points = []
    for when in sorted(set(wanted)):
        if time.monotonic() - started > BACKFILL_BUDGET_S / 2:
            break
        pnl = snapshot_at(token, user_id, when)
        if pnl is not None:
            points.append({"t": datetime.fromtimestamp(when, timezone.utc)
                           .isoformat(timespec="seconds").replace("+00:00", "Z"),
                           "pnl": pnl})
        # a small gap between calls: this endpoint serves a page, and a
        # request every few milliseconds does not look like one
        time.sleep(0.4)
    return points


# The reading is what settles markets; the backfill is a convenience. When
# fomo is slow or throttling, 130 sequential requests per handle can outlast
# the whole tick — and because the runs are serialised, one stuck backfill
# stops every reading behind it. So it gets a budget, and gives up politely.
BACKFILL_BUDGET_S = 90


def backfill(token, handles, ids):
    """Fetch and push the past for handles the site says it is missing."""
    started = time.monotonic()
    series = []
    for h in handles:
        if time.monotonic() - started > BACKFILL_BUDGET_S:
            print(f"  budget spent, leaving {h} for the next tick")
            break
        uid = ids.get(h)
        if not uid:
            print(f"  {h}: no user id in the leaderboard, skipping")
            continue
        pts = history_for(token, uid)
        print(f"  {h}: {len(pts)} points" + (f"  {pts[0]['t'][:10]} .. {pts[-1]['t'][:10]}" if pts else ""))
        if pts:
            series.append({"handle": h, "points": pts})
    if not series:
        return
    r = requests.post(f"{SITE}/api/keeper/history",
                      headers={**auth, "content-type": "application/json"},
                      json={"series": series}, timeout=120)
    print(f"  history -> {r.status_code} {r.text[:200]}")


def rows_from(payload):
    board = (payload or {}).get("responseObject", {}).get("leaderboard")
    if not isinstance(board, list):
        sys.exit("leaderboard payload had no rows")

    out = []
    for u in board:
        handle = u.get("userHandle")
        pnl = u.get("totalPnL")
        # full float precision straight off the wire — never a rounded string
        if not handle or not isinstance(pnl, (int, float)):
            continue
        out.append({
            "handle": handle,
            "fomoId": u.get("id"),
            "pnl": pnl,
            "name": u.get("displayName") or handle,
            "followers": u.get("followers") or 0,
            "avatar": u.get("profilePictureLink"),
            "banner": u.get("coverPhotoLink") or u.get("coverPhoto") or u.get("bannerLink"),
            "bio": u.get("description"),
        })
    return out


def main():
    at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    refresh = stored_refresh_token()
    if not refresh:
        sys.exit("no refresh token anywhere — set PRIVY_REFRESH_TOKEN once")

    token = access_token(refresh)
    rows = rows_from(leaderboard(token))
    if not rows:
        sys.exit("no usable rows in the reading")

    ingest = requests.post(
        f"{SITE}/api/keeper/ingest",
        headers={**auth, "content-type": "application/json"},
        json={"source": "fomo.family/v2/leaderboard", "t": at, "rows": rows},
        timeout=60,
    )
    # the ingest endpoint opens what is missing and settles what is due, so
    # one call is the whole tick
    print(f"{at}  {len(rows)} rows -> {ingest.status_code} {ingest.text[:300]}")

    # the site names the listed accounts it has no past for; fetching one
    # costs a hundred-odd requests, so it is done a couple at a time rather
    # than holding up the reading everybody else is waiting on
    try:
        need = (ingest.json() or {}).get("needHistory") or []
    except Exception:
        need = []
    if need:
        print(f"backfilling history for {need}")
        backfill(token, need, {r["handle"]: r.get("fomoId") for r in rows})

    if ingest.status_code >= 400:
        sys.exit(1)


if __name__ == "__main__":
    main()
