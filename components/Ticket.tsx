"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, Verified } from "./TraderCard";
import Chart, { type Point } from "./Chart";
import { impliedPrice, multiple, dilution, FEE_BPS } from "@/lib/pool";
import { usd, usdShort, cents } from "@/lib/format";
import { useVenue, useWallet } from "./WalletButton";
import {
  approveUSDG, claimOnChain, faucetUSDG, short, stakeOnChain, usdgAllowance,
} from "@/lib/wallet";
import { explorerTx } from "@/lib/chain";
import { windowLabel } from "@/lib/markets";
import type { Market, Side, Trader } from "@/lib/types";

const PRESETS = [25, 50, 100, 250];
/** The reference ticket every quoted multiple on the site is quoted for. */
const QUOTE_STAKE = 100;

type Phase = "idle" | "approving" | "staking" | "claiming";
type Msg = { ok: boolean; text: string; tx?: string };

function countdown(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function fmtDateUTC(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", hour12: true });
  return `${date}, ${time} UTC`;
}

export default function Ticket({
  market, trader, history, initialSide,
}: {
  market: Market; trader: Trader;
  history: { "24h": Point[]; "7d": Point[]; "30d": Point[]; all: Point[] };
  initialSide: Side;
}) {
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState<number | "">(100);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<Msg | null>(null);
  const [allowance, setAllowance] = useState<number | null>(null);
  const [claim, setClaim] = useState<{ amount: number; claimed: boolean } | null>(null);

  const venue = useVenue();
  const wallet = useWallet();

  const live = venue?.live === true;
  const busy = phase !== "idle";
  const closed = market.status !== "open" || new Date(market.closesAt).getTime() <= Date.now();

  const stake = typeof amount === "number" && amount > 0 ? amount : 0;
  const pools = market.pools;
  const price = { call: impliedPrice(pools, "call"), put: impliedPrice(pools, "put") };
  const shown = {
    call: multiple(pools, "call", QUOTE_STAKE),
    put: multiple(pools, "put", QUOTE_STAKE),
  };

  const mult = stake > 0 ? multiple(pools, side, stake) : multiple(pools, side, QUOTE_STAKE);
  const gross = stake * mult;
  const winnings = Math.max(0, gross - stake);
  // the quoted number is already net, so the fee is what was taken out of it
  const fee = (winnings / (1 - FEE_BPS / 10_000)) * (FEE_BPS / 10_000);
  const impact = stake > 0 ? dilution(pools, side, stake) : 0;

  const emptyOtherSide = (side === "call" ? pools.put : pools.call) <= 0;
  const shortOfFunds = wallet.balance != null && stake > wallet.balance;
  const needsWallet = !wallet.address;
  const needsApproval = allowance != null && allowance < stake;

  /* ---------------------------------------------------------- chain reads */

  const refreshAllowance = useCallback(async () => {
    if (!wallet.address || !live) { setAllowance(null); return; }
    try { setAllowance(await usdgAllowance(wallet.address)); } catch { setAllowance(null); }
  }, [wallet.address, live]);

  const refreshClaim = useCallback(async () => {
    if (!wallet.address || !live || market.status === "open") { setClaim(null); return; }
    try {
      const r = await fetch(`/api/portfolio?owner=${wallet.address}`).then((x) => x.json());
      const mine = (r.positions ?? []).filter((p: { marketId: number }) => p.marketId === market.id);
      if (!mine.length) { setClaim(null); return; }
      setClaim({
        amount: mine.reduce((s: number, p: { payout?: number }) => s + (p.payout ?? 0), 0),
        claimed: mine.every((p: { claimed: boolean }) => p.claimed),
      });
    } catch { setClaim(null); }
  }, [wallet.address, live, market.id, market.status]);

  useEffect(() => { void refreshAllowance(); }, [refreshAllowance]);
  useEffect(() => { void refreshClaim(); }, [refreshClaim]);

  /* ------------------------------------------------------------- actions */

  const submit = async () => {
    setMsg(null);
    if (!wallet.address) { await wallet.connectWallet(); return; }
    if (stake <= 0) return;

    try {
      if (needsApproval) {
        setPhase("approving");
        await approveUSDG(stake);
        await refreshAllowance();
      }
      setPhase("staking");
      const tx = await stakeOnChain(market.id, side, stake);
      setMsg({ ok: true, text: `${usd(stake)} on ${side === "call" ? "up" : "down"} is in the pot.`, tx });
      await Promise.all([wallet.refreshBalance(), refreshAllowance()]);
      // the pot moved, and the page was rendered from the old one
      setTimeout(() => window.location.reload(), 1400);
    } catch (e) {
      setMsg({ ok: false, text: cleanError(e) });
    } finally {
      setPhase("idle");
    }
  };

  const collect = async () => {
    setMsg(null);
    try {
      setPhase("claiming");
      const tx = await claimOnChain(market.id);
      setMsg({ ok: true, text: "Collected.", tx });
      await Promise.all([wallet.refreshBalance(), refreshClaim()]);
    } catch (e) {
      setMsg({ ok: false, text: cleanError(e) });
    } finally { setPhase("idle"); }
  };

  const question = `Will @${trader.handle} be up over the next ${market.window === "24h" ? "24 hours" : "7 days"}?`;
  const windowShort = market.window === "24h" ? "24h" : "7d";
  const chartPoints = useMemo(
    () => (history["30d"].length ? history["30d"] : history.all),
    [history],
  );

  return (
    <>
      {/* --------------------------------------------------------- header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--s-6)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap" }}>
            <Chip>Up or down · {windowLabel(market.window)}</Chip>
            <Chip tone={market.status === "open" && !closed ? "up" : "down"} dot>
              {market.status === "open" ? (closed ? "Closing" : "Open") : market.status}
            </Chip>
            <span style={{ fontSize: ".875rem", color: "var(--fg-faint)" }}>
              {closed ? "Closed" : `Closes in ${countdown(market.closesAt)}`} · {new Date(market.closesAt).toISOString().replace("T", " ").slice(0, 16)} UTC
            </span>
          </div>

          <h1 style={{ fontSize: "var(--step-3)", marginTop: "var(--s-4)", maxWidth: "22ch" }}>
            {question}
          </h1>

          <Link href={`/t/${trader.handle}`} style={{
            display: "inline-flex", alignItems: "center", gap: 10, marginTop: "var(--s-4)",
            padding: "7px 16px 7px 7px", borderRadius: "var(--r-full)",
            background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
          }}>
            <Avatar trader={trader as never} size={30} />
            <span style={{ fontWeight: 600, fontSize: ".9375rem", display: "flex", alignItems: "center", gap: 4 }}>
              {trader.name}<Verified />
            </span>
            <span style={{ color: "var(--fg-faint)", fontSize: ".875rem" }}>@{trader.handle}</span>
          </Link>
        </div>

        <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
          <Metric k="Up" v={cents(price.call)} tone="up" />
          <Metric k="Down" v={cents(price.put)} tone="down" />
          <Metric k="Pot" v={usd(market.volume, 0)} />
          <Metric k={closed ? "Status" : "Closes in"} v={closed ? market.status : countdown(market.closesAt)} />
        </div>
      </div>

      {/* -------------------------------------------------- body + panel */}
      <div style={{ display: "grid", gap: "var(--s-6)", gridTemplateColumns: "minmax(0,1fr) minmax(0,400px)", marginTop: "var(--s-8)", alignItems: "start" }} className="split">

        {/* ======================== LEFT COLUMN ======================== */}
        <div style={{ display: "grid", gap: "var(--s-4)" }}>

          {/* 1. the pot */}
          <Panel>
            <PanelHead
              left={<>
                <div className="eyebrow">The pot</div>
                <div className="num" style={{ fontSize: "1.75rem", fontWeight: 500, letterSpacing: "-.03em", marginTop: 2 }}>
                  {usd(market.volume)}
                </div>
              </>}
              right={<div className="eyebrow" style={{ textAlign: "right" }}>Staked, both sides</div>}
            />
            <div style={{ marginTop: "var(--s-5)" }}>
              <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "var(--surface-sunken)" }}>
                <div style={{ width: `${price.call * 100}%`, background: "var(--up)" }} />
                <div style={{ width: `${price.put * 100}%`, background: "var(--down)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--s-3)", fontSize: ".875rem" }}>
                <span className="num" style={{ color: "var(--up)" }}>
                  ↑ {usd(pools.call)} up <span style={{ color: "var(--fg-faint)" }}>· {shown.call.toFixed(2)}x</span>
                </span>
                <span className="num" style={{ color: "var(--down)" }}>
                  <span style={{ color: "var(--fg-faint)" }}>{shown.put.toFixed(2)}x ·</span> down {usd(pools.put)} ↓
                </span>
              </div>
            </div>
            <p style={{ margin: "var(--s-4) 0 0", fontSize: ".8125rem", color: "var(--fg-faint)", lineHeight: 1.6 }}>
              Every ticket on both sides is in this number, and the winning side is
              paid out of it. Nothing here is quoted against money the contract is
              not already holding.
            </p>
          </Panel>

          {/* 2. underlying */}
          <Panel>
            <PanelHead
              left={<>
                <div className="eyebrow">Underlying · total PnL</div>
                <div className="num" style={{ fontSize: "1.75rem", fontWeight: 500, letterSpacing: "-.03em", marginTop: 2 }}>
                  {usdShort(history.all.at(-1)?.pnl ?? 0)}
                </div>
              </>}
              right={<>
                <div className="eyebrow" style={{ textAlign: "right" }}>Struck at</div>
                <div className="num" style={{ fontWeight: 600, marginTop: 4, textAlign: "right" }}>
                  {market.strike != null ? usdShort(market.strike) : "—"}
                </div>
              </>}
            />
            <div style={{ marginTop: "var(--s-4)" }}>
              <Chart points={chartPoints} w={760} h={230} showAxis strokeWidth={2} />
            </div>
            <p style={{ margin: "var(--s-3) 0 0", fontSize: ".8125rem", color: "var(--fg-faint)" }}>
              Every snapshot behind this settlement is published to the evidence record.
              The same data source a reader can verify is the only input the oracle ever sees.
            </p>
          </Panel>

          {/* 3. resolution */}
          <div style={{ paddingTop: "var(--s-6)" }}>
            <h3 style={{ fontSize: "var(--step-1)", marginBottom: "var(--s-4)" }}>Resolution</h3>
            <dl style={{ display: "grid", gap: 0, fontSize: ".875rem", margin: 0 }}>
              <DefRow k="Settles on" v={`Sign of ${windowShort} PnL`} />
              <DefRow k="Settlement value" v="Median of the 3 snapshots nearest the close" />
              <DefRow k="Opened" v={fmtDateUTC(market.opensAt)} />
              <DefRow k="Closes" v={fmtDateUTC(market.closesAt)} />
              <DefRow k="If nobody publishes" v="Anyone can void it after 7 days" />
              <DefRow k="Collateral" v={venue?.live ? `USDG · ${venue.chainName}` : "USDG"} />
              {market.settleValue != null && <DefRow k="Settled at" v={usdShort(market.settleValue)} />}
            </dl>
            <p style={{ marginTop: "var(--s-4)", fontSize: ".8125rem", color: "var(--fg-faint)", lineHeight: 1.6 }}>
              The contract picks the winner from the two numbers rather than from
              anybody&apos;s opinion: above the strike is up, anything else is down.
              Where the record cannot support a settlement the market voids and every
              stake comes back at what it cost.
            </p>
          </div>

          {/* 4. the book */}
          <div style={{ paddingTop: "var(--s-4)", borderTop: "1px solid var(--border-subtle)" }}>
            <h3 style={{ fontSize: "var(--step-1)", marginBottom: "var(--s-4)" }}>The book</h3>
            <dl style={{ display: "grid", gap: 0, fontSize: ".875rem", margin: 0 }}>
              <DefRow k="Staked up" v={usd(pools.call)} />
              <DefRow k="Staked down" v={usd(pools.put)} />
              <DefRow k="Fee" v={`${FEE_BPS / 100}% of winnings, at claim`} />
              <DefRow k="Market id" v={`#${market.id}`} />
              {venue?.live && <DefRow k="Contract" v={short(venue.contract)} />}
            </dl>
            {venue?.live && (
              <a href={venue.explorer} target="_blank" rel="noreferrer"
                style={{ display: "inline-block", marginTop: "var(--s-4)", fontSize: ".8125rem", color: "var(--accent)" }}>
                Read the contract on the explorer →
              </a>
            )}
          </div>
        </div>

        {/* ===================== RIGHT COLUMN ===================== */}
        <div style={{
          position: "sticky", top: "calc(var(--nav-h) + 16px)",
          padding: "var(--s-5)", borderRadius: "var(--r-lg)",
          background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
        }}>
          <p style={{ fontSize: ".9375rem", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "var(--s-4)", lineHeight: 1.45 }}>
            {question}
          </p>

          {/* side toggle */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-2)" }}>
            {(["call", "put"] as Side[]).map((s) => {
              const on = side === s, isCall = s === "call";
              const tone = isCall ? "up" : "down";
              return (
                <button key={s} onClick={() => setSide(s)} style={{
                  padding: "12px 10px", borderRadius: "var(--r-md)", cursor: "pointer",
                  fontFamily: "inherit", textAlign: "center",
                  border: `1px solid ${on ? `color-mix(in srgb, var(--${tone}) 55%, transparent)` : "var(--border-subtle)"}`,
                  background: on ? `var(--${tone}-quiet)` : "var(--surface-sunken)",
                  color: on ? `var(--${tone})` : "var(--fg-muted)",
                  transition: "all var(--dur-micro) var(--ease-ui)",
                }}>
                  <div style={{ fontWeight: 600, fontSize: ".9375rem" }}>{isCall ? "↑ Up" : "↓ Down"}</div>
                  <div className="num" style={{ fontSize: "1.25rem", fontWeight: 600, marginTop: 2 }}>{shown[s].toFixed(2)}x</div>
                  <div className="num" style={{ fontSize: ".75rem", opacity: .7 }}>{cents(price[s])} of the pot</div>
                </button>
              );
            })}
          </div>

          {/* stake */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--s-3)", marginTop: "var(--s-5)" }}>
            <div className="eyebrow">You stake</div>
            {wallet.address && (
              <button
                onClick={() => { void wallet.refreshBalance(); }}
                title={`${wallet.address} — click to refresh`}
                style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: ".75rem", color: "var(--fg-faint)" }}
              >
                <span className="num">{wallet.balance == null ? "balance…" : `${wallet.balance.toFixed(2)} USDG`}</span>
                <span style={{ marginLeft: 6 }}>{short(wallet.address)}</span>
              </button>
            )}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginTop: "var(--s-2)",
            padding: "16px", borderRadius: "var(--r-md)",
            border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)",
          }}>
            <span className="num" style={{ fontSize: "1.625rem", fontWeight: 500, letterSpacing: "-.03em" }}>$</span>
            <input type="number" min={0} step={1} value={amount} placeholder="0"
              onChange={(e) => {
                const v = e.target.value;
                setAmount(v === "" ? "" : Math.max(0, Number(v)));
              }}
              className="num"
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                color: "var(--fg)", fontSize: "1.625rem", fontWeight: 500,
                letterSpacing: "-.03em", fontFamily: "inherit", minWidth: 0,
              }} />
            <span style={{
              fontSize: ".75rem", fontWeight: 500, color: "var(--fg-faint)",
              padding: "4px 9px", borderRadius: "var(--r-sm)", background: "var(--surface-raised)",
              border: "1px solid var(--border-subtle)",
            }}>USDG</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: "var(--s-2)" }}>
            {PRESETS.map((v) => (
              <button key={v} onClick={() => setAmount(v)} className="num" style={{
                padding: "9px 2px", borderRadius: "var(--r-md)", cursor: "pointer",
                border: `1px solid ${amount === v ? "var(--accent)" : "var(--border-subtle)"}`,
                background: amount === v ? "var(--accent-quiet)" : "transparent",
                color: amount === v ? "var(--accent-hover)" : "var(--fg-muted)",
                fontSize: ".8125rem", fontFamily: "inherit", fontWeight: 500,
              }}>${v}</button>
            ))}
          </div>

          {/* quote */}
          <dl style={{ margin: "var(--s-5) 0 0", display: "grid", gap: 0, fontSize: ".875rem" }}>
            <Row k="Your multiple" v={stake > 0 ? `${mult.toFixed(2)}x` : "—"} />
            <Row k="Dilution from your size" v={stake > 0 ? `${(impact * 100).toFixed(1)}%` : "—"} />
            <Row k={`Fee (${FEE_BPS / 100}% of winnings)`} v={stake > 0 ? usd(fee) : "—"} />
            <Row k="If you're right" v={stake > 0 ? usd(gross) : "—"} strong tone="var(--up)" />
            <Row k="If you're wrong" v={stake > 0 ? usd(0) : "—"} />
          </dl>

          {emptyOtherSide && stake > 0 && (
            <p style={{ marginTop: "var(--s-3)", fontSize: ".8125rem", color: "var(--fg-muted)", lineHeight: 1.55 }}>
              Nobody has taken the other side yet, so there is nothing to win here
              until somebody does. If none of them do before the close, the market
              voids and your stake comes back.
            </p>
          )}

          {/* action */}
          {claim && !claim.claimed && claim.amount > 0 ? (
            <button onClick={collect} disabled={busy} style={{
              width: "100%", marginTop: "var(--s-5)", padding: "15px",
              borderRadius: "var(--r-md)", border: "none", cursor: busy ? "progress" : "pointer",
              background: "var(--up)", color: "#04150c", fontWeight: 600, fontSize: "1rem", fontFamily: "inherit",
            }}>
              {phase === "claiming" ? "Confirm in your wallet…" : `Collect ${usd(claim.amount)}`}
            </button>
          ) : (
            (() => {
              const dead = closed || !live;
              const disabled = !needsWallet && (busy || dead || stake <= 0 || shortOfFunds || venue === null);
              return (
                <button onClick={submit} disabled={disabled} style={{
                  width: "100%", marginTop: "var(--s-5)", padding: "15px",
                  borderRadius: "var(--r-md)", border: "none",
                  cursor: dead ? "not-allowed" : busy ? "progress" : "pointer",
                  background: dead ? "var(--surface-sunken)" : "var(--accent)",
                  color: dead ? "var(--fg-faint)" : "var(--accent-contrast)",
                  fontWeight: 500, fontSize: "1rem", fontFamily: "inherit",
                  boxShadow: dead ? "none" : "var(--shadow-accent)",
                }}>
                  {venue === null ? "Checking the venue…"
                    : !live ? "No contract on this deployment"
                    : market.status !== "open" ? `Market ${market.status}`
                    : closed ? "Closed, waiting on settlement"
                    : phase === "approving" ? "Approve USDG in your wallet…"
                    : phase === "staking" ? "Confirm the ticket…"
                    : needsWallet ? "Connect wallet"
                    : stake <= 0 ? "Enter an amount"
                    : shortOfFunds ? "Not enough USDG"
                    : needsApproval ? `Approve and stake ${usd(stake)}`
                    : `Stake ${usd(stake)} on ${side === "call" ? "up" : "down"}`}
                </button>
              );
            })()
          )}

          {claim?.claimed && (
            <p style={{ marginTop: "var(--s-3)", fontSize: ".8125rem", color: "var(--fg-faint)" }}>
              You have already collected on this market.
            </p>
          )}

          {venue?.live && venue.testnet && wallet.address && (
            <button
              onClick={() => { void faucetUSDG().then(() => wallet.refreshBalance()); }}
              style={{
                width: "100%", marginTop: "var(--s-2)", padding: "10px",
                borderRadius: "var(--r-md)", cursor: "pointer",
                background: "transparent", border: "1px dashed var(--border-strong)",
                color: "var(--fg-muted)", fontSize: ".8125rem", fontFamily: "inherit",
              }}
            >
              Testnet — get 10,000 play USDG
            </button>
          )}

          {live && !wallet.address && !wallet.installed && (
            <p style={{ marginTop: "var(--s-3)", fontSize: ".8125rem", color: "var(--fg-faint)" }}>
              No wallet was found in this browser.{" "}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                Install one
              </a>{" "}
              to trade.
            </p>
          )}

          {msg && (
            <p style={{ marginTop: "var(--s-3)", fontSize: ".8125rem", color: msg.ok ? "var(--up)" : "var(--down)", lineHeight: 1.5 }}>
              {msg.text}
              {msg.tx && (
                <>
                  {" "}
                  <a href={explorerTx(msg.tx)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>
                    View transaction
                  </a>
                </>
              )}
            </p>
          )}

          <p style={{ marginTop: "var(--s-3)", fontSize: ".75rem", lineHeight: 1.5, color: "var(--fg-faint)" }}>
            {venue === null
              ? "Checking how this book settles…"
              : !live
              ? "No market contract is configured for this deployment, so nothing here can be traded."
              : venue.testnet
              ? "This deployment runs on the Robinhood Chain testnet. The USDG is play money, and so is anything you win."
              : "Your stake goes into the contract, not into an account somebody controls. Winnings are claimed by you, from the contract, once the market settles — nobody has to send them to you."}
          </p>
          <p style={{ marginTop: "var(--s-2)", fontSize: ".75rem", color: "var(--fg-faint)", lineHeight: 1.5 }}>
            Multiples are quoted on a {usd(QUOTE_STAKE, 0)} ticket, after the fee.{" "}
            <Link href="/portfolio" style={{ color: "var(--accent)" }}>Portfolio</Link>.
          </p>
        </div>
      </div>
      <style>{`@media (max-width: 980px){ .split{grid-template-columns:1fr !important} }`}</style>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared sub-components                                               */
/* ------------------------------------------------------------------ */

/** Wallet errors arrive as a wall of RPC prose, and only the first line of
 *  it ever tells the holder anything. */
function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied/i.test(raw)) return "You cancelled that in your wallet.";
  if (/insufficient funds/i.test(raw)) return "Not enough ETH in that wallet to pay for gas.";
  return raw.split("\n")[0].trim().slice(0, 180);
}

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    padding: "var(--s-5)", borderRadius: "var(--r-lg)",
    background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
  }}>{children}</div>
);

const PanelHead = ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--s-4)" }}>
    <div>{left}</div><div>{right}</div>
  </div>
);

function Chip({ children, tone, dot }: { children: React.ReactNode; tone?: "up" | "down"; dot?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 11px", borderRadius: "var(--r-sm)", fontSize: ".8125rem", fontWeight: 500,
      background: tone ? `var(--${tone}-quiet)` : "var(--surface-sunken)",
      color: tone ? `var(--${tone})` : "var(--fg-muted)",
      border: "1px solid var(--border-subtle)", textTransform: tone ? "capitalize" : "none",
    }}>
      {dot && <i className="live-dot" style={{ width: 6, height: 6, borderRadius: 9, background: "currentColor" }} />}
      {children}
    </span>
  );
}

/**
 * The header stat: label over value in a hairline box, which is how the fomo
 * app carries price, market cap and volume across the top of a token.
 */
function Metric({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div style={{
      textAlign: "center", minWidth: 92, padding: "7px 14px",
      borderRadius: "var(--r-md)", background: "var(--surface-raised)",
      border: "1px solid var(--border-subtle)",
    }}>
      <div style={{ fontSize: ".6875rem", color: "var(--fg-faint)" }}>{k}</div>
      <div className="num" style={{
        fontSize: "1rem", fontWeight: 600, letterSpacing: "-.02em", marginTop: 1,
        color: tone ? `var(--${tone})` : "var(--fg)",
      }}>{v}</div>
    </div>
  );
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 12,
      padding: "9px 0", borderTop: "1px solid var(--border-subtle)",
    }}>
      <dt style={{ color: "var(--fg-faint)" }}>{k}</dt>
      <dd className="num" style={{
        margin: 0, fontWeight: strong ? 700 : 600,
        fontSize: strong ? "1rem" : undefined, color: tone ?? "var(--fg)",
      }}>{v}</dd>
    </div>
  );
}

function DefRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 12,
      padding: "9px 0", borderTop: "1px solid var(--border-subtle)",
    }}>
      <dt style={{ color: "var(--fg-faint)" }}>{k}</dt>
      <dd style={{ margin: 0, fontWeight: 500, color: "var(--fg)", textAlign: "right" }}>{v}</dd>
    </div>
  );
}
