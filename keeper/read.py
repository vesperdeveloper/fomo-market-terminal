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
    """The site holds the current one; the environment is only a seed."""
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


def leaderboard(token):
    headers = {
        "authorization": f"Bearer {token}",
        "app-language": "en",
        "x-supported-chains": "1,56,143,4663,8453,1399811149",
        "content-type": "application/json",
        "origin": "https://fomo.family",
        "referer": "https://fomo.family/",
        "user-agent": UA,
    }
    r = requests.get("https://prod-api.fomo.family/v2/leaderboard", headers=headers,
                     impersonate=IMPERSONATE, timeout=45)
    if r.status_code != 200:
        sys.exit(f"leaderboard read failed: {r.status_code} {r.text[:200]}")
    return r.json()


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

    rows = rows_from(leaderboard(access_token(refresh)))
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

    if ingest.status_code >= 400:
        sys.exit(1)


if __name__ == "__main__":
    main()
