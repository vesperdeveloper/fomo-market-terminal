#!/bin/sh
# Payout sheet: who is owed what. Run from the project root.
#   ./scripts/ledger.sh                       -> production
#   ./scripts/ledger.sh http://localhost:3070 -> a local server
S=""
[ -f .keeper-secret ] && S=$(tr -d '\r\n' < .keeper-secret)
[ -z "$S" ] && [ -f .env.local ] && S=$(grep '^KEEPER_SECRET=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -z "$S" ] && { echo "no KEEPER_SECRET found (.keeper-secret or .env.local)"; exit 1; }

curl -s -H "authorization: Bearer $S" "${1:-https://fomomarket.vercel.app}/api/ledger" \
| python3 -c '
import sys, json
raw = sys.stdin.read()
try: d = json.loads(raw)
except Exception: print("bad response:", raw[:200]); sys.exit(1)
if "error" in d: print("error:", d["error"]); sys.exit(1)
t, m = d["treasury"], d["money"]
print("treasury %s" % t["address"])
print("  USDG %.2f   ETH(gas) %.6f   can pay: %s   unbacked: %s"
      % (t["collateral"], t["gas"], t["canPay"], t["unbacked"]))
print()
print("taken in      $%.2f" % m["takenIn"])
print("due now       $%.2f   <- settled and unclaimed: pay these" % m["dueNow"])
print("worst case    $%.2f   <- if every open side wins" % m["worstCase"])
print("shortfall     $%.2f" % m["shortfall"])
print("already paid  $%.2f" % m["alreadyPaid"])
for title, key in (("DUE NOW", "dueNowRows"), ("STILL OPEN", "openRows")):
    rows = d.get(key) or []
    if not rows: continue
    print(); print(title)
    for r in rows:
        print("  %s  #%-3d @%-16s %-4s paid $%-8.2f owes $%.2f"
              % (r["wallet"], r["market"], r["handle"], r["side"], r["paid"], r["owes"]))
print()
print("nothing owed yet." if not (d.get("dueNowRows") or d.get("openRows")) else "")
'
