"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usd, cents } from "@/lib/format";
import { useTreasury, useWallet, WalletButton, type Treasury } from "./WalletButton";
import { explorerTx } from "@/lib/chain";

/** What /api/redeem knows about a position: what it is owed, what it was paid. */
interface RedeemRow {
  id: string;
  status: string;
  won: boolean;
  voided: boolean;
  claimable: number;
  claimedAt: string | null;
  payoutTx: string | null;
  depositTx: string | null;
}

export default function PortfolioClient() {
  const treasury = useTreasury();
  const wallet = useWallet();
  const live = treasury?.live === true;

  /**
   * What the treasury can pay right now. A claim is still worth making when
   * it cannot - the position is recorded either way - but the button should
   * not imply the money arrives on the click.
   */
  const funded =
    treasury !== null && treasury.live === true
      ? (treasury as Extract<Treasury, { live: true }> & { canPay?: boolean })
      : null;
  const canPayNow = (amount: number) =>
    funded === null || (funded.canPay !== false && funded.collateral >= amount);

  const [localOwner, setLocalOwner] = useState("");
  const [data, setData] = useState<any>(null);
  const [claims, setClaims] = useState<Record<string, RedeemRow>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string; tx?: string } | null>(null);

  useEffect(() => {
    try { setLocalOwner(localStorage.getItem("fomomarket.owner") ?? ""); } catch {}
  }, []);

  // positions are keyed by wallet address once the deployment takes real money
  const owner = live ? wallet.address ?? "" : localOwner;

  const load = useCallback(async () => {
    if (!owner) { setData(null); setClaims({}); return; }
    const [portfolio, redeemable] = await Promise.all([
      fetch(`/api/portfolio?owner=${owner}`).then((x) => x.json()).catch(() => null),
      fetch(`/api/redeem?owner=${owner}`).then((x) => x.json()).catch(() => null),
    ]);
    setData(portfolio);
    const map: Record<string, RedeemRow> = {};
    for (const r of (redeemable?.positions ?? []) as RedeemRow[]) map[r.id] = r;
    setClaims(map);
  }, [owner]);

  useEffect(() => { load(); }, [load]);

  /**
   * Collect a settled position.
   *
   * On a live deployment this moves real USDG out of the treasury, so the
   * server's own error text is shown untouched - it is written to be read.
   */
  async function claim(id: string) {
    if (!owner) return;
    setBusy(id); setMsg(null);
    try {
      const res = await fetch(live ? "/api/redeem" : "/api/portfolio", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(live ? { owner, position: id } : { owner, id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "could not collect that position");
      if (live) {
        setMsg(body.tx
          ? { id, ok: true, text: `Paid ${usd(body.paid ?? 0)} to your wallet.`, tx: body.tx }
          : { id, ok: true, text: body.reason ?? "Nothing to pay on that position." });
      }
      await load();
      void wallet.refreshBalance();
    } catch (e) {
      setMsg({ id, ok: false, text: e instanceof Error ? e.message : "could not collect" });
    } finally { setBusy(null); }
  }

  if (treasury === null) return <Empty text="Loading…" />;

  // A position is keyed to the wallet that paid for it, so reading them back
  // does need one — but it is offered, not demanded, and nothing is asked for
  // until this button is pressed.
  if (live && !wallet.address) {
    return (
      <div style={{ marginTop: "var(--s-8)", display: "grid", gap: "var(--s-3)", justifyItems: "start" }}>
        <p style={{ color: "var(--fg-muted)", margin: 0, maxWidth: "52ch", lineHeight: 1.6 }}>
          Positions are held by the wallet that paid for them. Connect one to read
          yours back — nothing else on the site needs it.
        </p>
        <button
          onClick={() => { void wallet.connectWallet(); }}
          disabled={wallet.connecting}
          style={{
            padding: "10px 18px", borderRadius: "var(--r-md)", cursor: "pointer",
            background: "var(--accent)", border: "none", color: "var(--accent-contrast)",
            fontWeight: 500, fontSize: ".9375rem", fontFamily: "inherit",
          }}
        >
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {wallet.error && (
          <p style={{ color: "var(--down)", fontSize: ".8125rem", margin: 0 }}>{wallet.error}</p>
        )}
      </div>
    );
  }

  if (!owner) return <Empty text="No local identity yet — place a position first." />;
  if (!data) return <Empty text="Loading…" />;
  if (!data.positions?.length) return <Empty text="Nothing here yet." />;

  const owed = Object.values(claims).reduce((s, r) => s + (r.claimable ?? 0), 0);

  return (
    <>
      {live && (
        <div style={{ marginTop: "var(--s-6)", display: "flex", justifyContent: "flex-end" }}>
          <WalletButton wallet={wallet} />
        </div>
      )}

      {owed > 0 && (
        <div style={{
          marginTop: "var(--s-6)", padding: "var(--s-5)", borderRadius: "var(--r-lg)",
          background: "var(--up-quiet)", border: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s-4)",
        }}>
          <span style={{ color: "var(--up)", fontWeight: 600 }}>Ready to collect</span>
          <span className="num" style={{ color: "var(--up)", fontWeight: 700, fontSize: "1.25rem" }}>
            {usd(owed)}
          </span>
        </div>
      )}

      <div style={{ display: "grid", gap: "var(--s-3)", marginTop: "var(--s-6)" }}>
        {data.positions.map((p: any) => {
          const r = claims[p.id];
          const claimable = r?.claimable ?? 0;
          const note = msg?.id === p.id ? msg : null;
          const slow = claimable > 0 && !canPayNow(claimable);
          return (
            <div key={p.id} style={{
              padding: "var(--s-4)", borderRadius: "var(--r-lg)",
              background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
              boxShadow: "var(--shadow-1)",
            }}>
              <div style={{
                display: "grid", gap: "var(--s-4)", alignItems: "center",
                gridTemplateColumns: "minmax(0,2fr) repeat(3, minmax(0,1fr)) auto",
              }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/m/${p.marketId}`} style={{ fontWeight: 600 }}>
                    @{p.market.handle} · {p.market.window}
                  </Link>
                  <div style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>
                    {p.side === "call" ? "↑ Call" : "↓ Put"} · {p.shares.toFixed(2)} shares
                  </div>
                </div>
                <Cell k="Cost" v={usd(p.cost)} />
                {p.state === "open"
                  ? <Cell k="Mark" v={cents(p.markPrice)} />
                  : <Cell k="Fee" v={usd(p.fee ?? 0)} />}
                <Cell k={p.state === "open" ? "Value" : "Payout"}
                  v={usd(p.state === "open" ? p.markValue : (p.net ?? 0))}
                  tone={p.state === "lost" ? "down" : p.state === "open" ? undefined : "up"} />
                <div style={{ textAlign: "right" }}>
                  <Badge state={p.state} />
                  {claimable > 0 && (
                    <button onClick={() => claim(p.id)} disabled={busy === p.id} style={{
                      display: "block", marginTop: 6, marginLeft: "auto",
                      padding: "8px 14px", borderRadius: "var(--r-md)",
                      border: "none", background: "var(--accent)", color: "var(--accent-contrast)",
                      fontWeight: 600, fontSize: ".8125rem",
                      cursor: busy === p.id ? "progress" : "pointer", fontFamily: "inherit",
                    }}>
                      {busy === p.id ? "Paying…" : `Claim ${usd(claimable)}`}
                    </button>
                  )}
                </div>
              </div>

              {/* payment trail: what was paid in, and what came back out */}
              {(r?.payoutTx || r?.claimedAt || r?.depositTx || note || slow) && (
                <div style={{
                  marginTop: "var(--s-3)", paddingTop: "var(--s-3)",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex", flexWrap: "wrap", gap: "var(--s-3)",
                  fontSize: ".75rem", color: "var(--fg-faint)", alignItems: "center",
                }}>
                  {r?.depositTx && <TxLink hash={r.depositTx} label="Stake paid" />}
                  {r?.payoutTx
                    ? <TxLink hash={r.payoutTx} label="Payout sent" />
                    : r?.claimedAt && claimable === 0 && <span>Closed out</span>}
                  {/* claiming is still worth doing - it just may not land today */}
                  {slow && !note && (
                    <span style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}>
                      This payout is settled by the operator, and may take a while if the treasury is short.
                    </span>
                  )}
                  {note && (
                    <span style={{ color: note.ok ? "var(--up)" : "var(--down)", lineHeight: 1.5 }}>
                      {note.text}
                      {note.tx && (
                        <>
                          {" "}
                          <a href={explorerTx(note.tx)} target="_blank" rel="noreferrer"
                            style={{ color: "var(--accent)", fontWeight: 600 }}>
                            View transaction
                          </a>
                        </>
                      )}
                    </span>
                  )}
                  {/* a refused claim is not a lost one, and the server's
                      reason above says nothing about that either way */}
                  {note && !note.ok && (
                    <span style={{ flexBasis: "100%", color: "var(--fg-muted)", lineHeight: 1.5 }}>
                      Your position is still recorded and will be paid — nothing has been lost.
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

const Empty = ({ text }: { text: string }) => (
  <p style={{ marginTop: "var(--s-8)", color: "var(--fg-faint)" }}>{text}</p>
);

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer"
      style={{ color: "var(--fg-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>
      {label} ↗
    </a>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div>
      <div className="eyebrow">{k}</div>
      <div className="num" style={{ fontWeight: 600, marginTop: 2, color: tone ? `var(--${tone})` : "var(--fg)" }}>{v}</div>
    </div>
  );
}

function Badge({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    open: ["var(--fg-muted)", "var(--surface-sunken)"],
    won: ["var(--up)", "var(--up-quiet)"],
    lost: ["var(--down)", "var(--down-quiet)"],
    void: ["var(--accent)", "var(--accent-quiet)"],
  };
  const [fg, bg] = map[state] ?? map.open;
  return (
    <span style={{
      padding: "5px 11px", borderRadius: "var(--r-sm)", background: bg, color: fg,
      fontSize: ".75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em",
    }}>{state}</span>
  );
}
