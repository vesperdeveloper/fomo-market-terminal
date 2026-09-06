"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usd, cents } from "@/lib/format";
import { useVenue, useWallet, WalletButton } from "./WalletButton";
import { claimOnChain } from "@/lib/wallet";
import { explorerTx } from "@/lib/chain";
import type { Market, Position, Trader } from "@/lib/types";

type Row = Position & {
  market: Market;
  trader: Trader | null;
  state: "open" | "won" | "lost" | "void";
};

export default function PortfolioClient() {
  const venue = useVenue();
  const wallet = useWallet();
  const live = venue?.live === true;

  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ id: number; ok: boolean; text: string; tx?: string } | null>(null);

  const owner = wallet.address ?? "";

  const load = useCallback(async () => {
    if (!owner) { setRows(null); return; }
    const r = await fetch(`/api/portfolio?owner=${owner}`).then((x) => x.json()).catch(() => null);
    setRows((r?.positions ?? []) as Row[]);
  }, [owner]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Collect a settled position or a refund.
   *
   * The holder signs this themselves and the contract pays them directly.
   * Nothing here asks a server for permission, which is why there is no state
   * in which a payout is "pending an operator".
   */
  async function collect(marketId: number) {
    setBusy(marketId); setMsg(null);
    try {
      const tx = await claimOnChain(marketId);
      setMsg({ id: marketId, ok: true, text: "Collected.", tx });
      await load();
      void wallet.refreshBalance();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "could not collect";
      setMsg({
        id: marketId, ok: false,
        text: /user rejected|denied/i.test(raw) ? "You cancelled that in your wallet." : raw.split("\n")[0].slice(0, 160),
      });
    } finally { setBusy(null); }
  }

  if (venue === null) return <Empty text="Loading…" />;

  if (!live) {
    return (
      <Empty text="No market contract is configured for this deployment, so there are no positions to read." />
    );
  }

  if (!wallet.address) {
    return (
      <div style={{ marginTop: "var(--s-8)", display: "grid", gap: "var(--s-3)", justifyItems: "start" }}>
        <p style={{ color: "var(--fg-faint)", margin: 0 }}>
          Positions live in the contract, keyed to the wallet that staked them.
          Connect that wallet to read yours.
        </p>
        <WalletButton wallet={wallet} />
        {wallet.error && (
          <p style={{ color: "var(--down)", fontSize: ".8125rem", margin: 0 }}>{wallet.error}</p>
        )}
      </div>
    );
  }

  if (rows === null) return <Empty text="Loading…" />;
  if (!rows.length) return <Empty text="Nothing here yet." />;

  const owed = rows
    .filter((r) => !r.claimed && (r.state === "won" || r.state === "void"))
    .reduce((s, r) => s + (r.payout ?? 0), 0);

  return (
    <>
      <div style={{ marginTop: "var(--s-6)", display: "flex", justifyContent: "flex-end" }}>
        <WalletButton wallet={wallet} />
      </div>

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
        {rows.map((p) => {
          const key = `${p.marketId}-${p.side}`;
          const claimable = !p.claimed && (p.state === "won" || p.state === "void") ? (p.payout ?? 0) : 0;
          const note = msg?.id === p.marketId ? msg : null;
          return (
            <div key={key} style={{
              padding: "var(--s-4)", borderRadius: "var(--r-lg)",
              background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
            }}>
              <div style={{
                display: "grid", gap: "var(--s-4)", alignItems: "center",
                gridTemplateColumns: "minmax(0,2fr) repeat(3, minmax(0,1fr)) auto",
              }} className="pf-row">
                <div style={{ minWidth: 0 }}>
                  <Link href={`/m/${p.marketId}`} style={{ fontWeight: 600 }}>
                    @{p.market.handle} · {p.market.window}
                  </Link>
                  <div style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>
                    {p.side === "call" ? "↑ Up" : "↓ Down"} · market #{p.marketId}
                  </div>
                </div>
                <Cell k="Staked" v={usd(p.stake)} />
                <Cell
                  k={p.state === "open" ? "Pot share" : "Outcome"}
                  v={p.state === "open"
                    ? cents(p.market.volume > 0
                        ? (p.side === "call" ? p.market.pools.call : p.market.pools.put) / p.market.volume
                        : 0.5)
                    : p.state} />
                <Cell
                  k={p.state === "open" ? "If it lands" : "Payout"}
                  v={usd(p.markedAt)}
                  tone={p.state === "lost" ? "down" : p.state === "open" ? undefined : "up"} />
                <div style={{ textAlign: "right" }}>
                  <Badge state={p.state} />
                  {claimable > 0 && (
                    <button onClick={() => collect(p.marketId)} disabled={busy === p.marketId} style={{
                      display: "block", marginTop: 6, marginLeft: "auto",
                      padding: "8px 14px", borderRadius: "var(--r-md)",
                      border: "none", background: "var(--accent)", color: "var(--accent-contrast)",
                      fontWeight: 500, fontSize: ".8125rem",
                      cursor: busy === p.marketId ? "progress" : "pointer", fontFamily: "inherit",
                    }}>
                      {busy === p.marketId ? "Confirm in wallet…" : `Collect ${usd(claimable)}`}
                    </button>
                  )}
                  {p.claimed && p.state !== "open" && (
                    <div style={{ marginTop: 6, fontSize: ".75rem", color: "var(--fg-faint)" }}>collected</div>
                  )}
                </div>
              </div>

              {note && (
                <div style={{
                  marginTop: "var(--s-3)", paddingTop: "var(--s-3)",
                  borderTop: "1px solid var(--border-subtle)",
                  fontSize: ".75rem", color: note.ok ? "var(--up)" : "var(--down)", lineHeight: 1.5,
                }}>
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
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{`@media (max-width: 760px){ .pf-row{grid-template-columns:1fr 1fr !important} }`}</style>
    </>
  );
}

const Empty = ({ text }: { text: string }) => (
  <p style={{ marginTop: "var(--s-8)", color: "var(--fg-faint)", maxWidth: "56ch", lineHeight: 1.6 }}>{text}</p>
);

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
    void: ["var(--accent-hover)", "var(--accent-quiet)"],
  };
  const [fg, bg] = map[state] ?? map.open;
  return (
    <span style={{
      padding: "5px 11px", borderRadius: "var(--r-sm)", background: bg, color: fg,
      fontSize: ".75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em",
    }}>{state}</span>
  );
}
