"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, Verified } from "./TraderCard";
import Chart, { type Point } from "./Chart";
import { quoteBuy, spotPrice, QUOTE_STAKE } from "@/lib/amm";
import { netMultiple } from "@/lib/prior";
import { FEE_BPS } from "@/lib/settlement";
import { usd, usdShort, cents } from "@/lib/format";
import { useTreasury, useWallet, type Treasury } from "./WalletButton";
import { payUSDG, short } from "@/lib/wallet";
import { explorerTx } from "@/lib/chain";
import type { Market, Side, Trader } from "@/lib/types";

const OWNER_KEY = "fomomarket.owner";
const PRESETS = [25, 50, 100, 250];

function useOwner() {
  const [owner, setOwner] = useState("");
  useEffect(() => {
    try {
      let o = localStorage.getItem(OWNER_KEY);
      if (!o) { o = "u_" + Math.random().toString(36).slice(2, 10); localStorage.setItem(OWNER_KEY, o); }
      setOwner(o);
    } catch { setOwner("anon"); }
  }, []);
  return owner;
}

type Phase = "idle" | "checking" | "signing" | "confirming" | "filling";

type Msg = { ok: boolean; text: string; tx?: string; kind?: "refund" };

/**
 * A refused buy that already took the money reads differently from every
 * other failure: the server sends the stake back and names the refund in the
 * message. Spotting that here is what lets the ticket say so plainly instead
 * of filing it under "trade failed".
 */
const REFUNDED = /\brefund(ed)?\b|\bsent back\b/i;
/** The server could not send it back and is asking for the payment to be quoted. */
const REFUND_PENDING = /could not be returned/i;
function refundHash(text: string) {
  return text.match(/0x[0-9a-fA-F]{64}/)?.[0];
}

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
  market: initial, trader, history, initialSide,
}: {
  market: Market; trader: Trader;
  history: { "24h": Point[]; "7d": Point[]; "30d": Point[]; all: Point[] };
  initialSide: Side;
}) {
  const [market, setMarket] = useState(initial);
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState<number | "">(100);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<Msg | null>(null);
  const localOwner = useOwner();
  const treasury = useTreasury();
  const wallet = useWallet();

  const live = treasury?.live === true;
  const busy = phase !== "idle";

  /**
   * A live venue with no headroom cannot back a new position, so the book is
   * shut for funding rather than broken. Existing tickets and their payouts
   * are untouched by this - only new size is refused.
   *
   * Unless the operator has opened the book unbacked: then the server takes
   * the stake knowingly and settles the shortfall by hand, so the ticket has
   * no business refusing a trade the server would accept.
   */
  const funded =
    treasury !== null && treasury.live === true
      ? (treasury as Extract<Treasury, { live: true }> & { canPay?: boolean; unbacked?: boolean })
      : null;
  const unbacked = funded?.unbacked === true;
  const fundingPaused =
    funded !== null && !unbacked && (funded.collateral === 0 || funded.headroom <= 0);

  /**
   * Whether a win would actually be wired back on its own. Any of these means
   * it would not: an unbacked book, a treasury with no gas to send with, or
   * less collateral than the book already owes.
   */
  const manualSettlement =
    funded !== null &&
    (unbacked || funded.canPay === false || funded.collateral < funded.liability);

  const stake = typeof amount === "number" && amount > 0 ? amount : 0;
  const quote = useMemo(() => {
    if (stake <= 0) return null;
    try { return quoteBuy(market.reserves, side, stake); }
    catch { return null; }
  }, [market, side, stake]);

  const price = { call: spotPrice(market.reserves, "call"), put: spotPrice(market.reserves, "put") };
  const shown = {
    call: netMultiple(quoteBuy(market.reserves, "call", QUOTE_STAKE).shares, QUOTE_STAKE),
    put: netMultiple(quoteBuy(market.reserves, "put", QUOTE_STAKE).shares, QUOTE_STAKE),
  };

  const winnings = quote ? Math.max(0, quote.shares - stake) : 0;
  const fee = (winnings * FEE_BPS) / 10_000;
  const net = quote ? quote.shares - fee : 0;
  const impact = quote ? Math.abs(quote.priceAfter - quote.priceBefore) : 0;
  const closed = market.status !== "open";
  const tooBig = impact > 0.05;
  const payoutMult = quote && stake > 0 ? net / stake : 0;

  const needsWallet = live && !wallet.address;
  const shortOfFunds =
    live && wallet.address != null && wallet.balance != null && stake > wallet.balance + 1e-9;

  /* Synthetic two-point series for the call price chart (flat line at current spot) */
  const pricePoints: Point[] = useMemo(() => [
    { t: market.opensAt, pnl: price.call },
    { t: new Date().toISOString(), pnl: price.call },
  ], [market.opensAt, price.call]);

  const windowLabel = market.window === "24h" ? "24 hours" : "7 days";
  const windowShort = market.window === "24h" ? "1-day" : "7-day";
  const question = `Will @${trader.handle} be up over the next ${windowLabel}?`;

  async function refreshMarket() {
    const fresh = await fetch(`/api/markets?handle=${market.handle}`).then((r) => r.json());
    const m = fresh.markets?.find((x: Market) => x.id === market.id);
    if (m) setMarket(m);
  }

  /**
   * Ask first, then pay, then book.
   *
   * The stake still leaves the wallet before the ticket is booked, because
   * the server re-reads that receipt and refuses a position it cannot find
   * on chain. What comes first is a dry run of the same capacity check the
   * real buy makes: a book that cannot take this size says so while the
   * money is still the buyer's, rather than after taking it.
   */
  async function submit() {
    if (!quote || busy || closed || tooBig || stake <= 0) return;
    if (!treasury) return;                         // still learning the deployment
    if (fundingPaused) return;                     // no collateral behind new size
    // a refund notice is the one message worth more than the next attempt:
    // it is the only place the buyer is told their money came back
    setMsg((m) => (m?.kind === "refund" ? m : null));

    // ------------------------------------------------ dev / unpriced build
    if (!live) {
      setPhase("filling");
      try {
        await post({ market: market.id, side, amount, owner: localOwner });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "trade failed" });
      } finally { setPhase("idle"); }
      return;
    }

    // ------------------------------------------------------- real money
    const address = wallet.address ?? (await wallet.connectWallet());
    if (!address) {
      if (wallet.error) setMsg({ ok: false, text: wallet.error });
      return;
    }
    if (!treasury.live) return;

    // ------------------------------------------------------- preflight
    // The server runs the same capacity check on a buy as it does here, so
    // a refusal now is the refusal the real trade would have given - except
    // that nothing has been paid yet. Asking first is the difference between
    // declining a trade and taking a stake for a ticket that cannot exist.
    setPhase("checking");
    try {
      const res = await fetch("/api/trade", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ market: market.id, side, amount, owner: address, dryRun: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "this book cannot take that size right now" });
        setPhase("idle");
        return;
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "could not check the book" });
      setPhase("idle");
      return;
    }

    let hash: string;
    setPhase("signing");
    // the wallet prompt is a separate window; getting focus back is the
    // closest a page gets to being told the user has finished with it
    const toConfirming = () => setPhase((p) => (p === "signing" ? "confirming" : p));
    window.addEventListener("focus", toConfirming);
    const fallback = window.setTimeout(toConfirming, 20_000);
    try {
      hash = await payUSDG(treasury.address, stake);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "the payment failed" });
      setPhase("idle");
      return;
    } finally {
      window.removeEventListener("focus", toConfirming);
      window.clearTimeout(fallback);
    }

    setPhase("filling");
    try {
      await post({ market: market.id, side, amount, owner: address, depositTx: hash }, hash);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "trade failed";
      // the money is on chain either way, so say so rather than swallowing it
      setMsg(
        REFUNDED.test(reason)
          // the server already sent the stake back and named the refund; that
          // message is the receipt, so it is passed through untouched
          ? { ok: false, kind: "refund", text: reason, tx: refundHash(reason) ?? hash }
          : { ok: false, text: `${reason} — your payment is on chain.`, tx: hash },
      );
    } finally {
      setPhase("idle");
      void wallet.refreshBalance();
    }
  }

  async function post(body: Record<string, unknown>, tx?: string) {
    const res = await fetch("/api/trade", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "trade failed");
    setMsg({
      ok: true,
      text: `Filled ${data.position.shares.toFixed(2)} ${side} shares at ${cents(data.avgPrice)}.`,
      tx,
    });
    await refreshMarket();
  }

  return (
    <>
      {/* --------------------------------------------------------- header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--s-6)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap" }}>
            <Chip>Calls and puts · {market.window === "24h" ? "1 day" : "7 days"}</Chip>
            <Chip tone={closed ? "down" : "up"} dot>{closed ? market.status : "Open"}</Chip>
            <span style={{ fontSize: ".875rem", color: "var(--fg-faint)" }}>
              {closed ? "Closed" : `Closes in ${countdown(market.closesAt)}`} · {new Date(market.closesAt).toISOString().replace("T", " ").slice(0, 16)} UTC
            </span>
          </div>

          <h1 style={{ fontSize: "var(--step-3)", marginTop: "var(--s-4)", maxWidth: "22ch" }}>
            {question}
          </h1>

          <Link href={`/t/${trader.handle}`} style={{
            display: "inline-flex", alignItems: "center", gap: 10, marginTop: "var(--s-4)",
            padding: "7px 16px 7px 7px", borderRadius: "var(--r-full)",  /* the one pill fomo keeps: an account chip */
            background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-1)",
          }}>
            <Avatar trader={trader as any} size={30} />
            <span style={{ fontWeight: 600, fontSize: ".9375rem", display: "flex", alignItems: "center", gap: 4 }}>
              {trader.name}<Verified />
            </span>
            <span style={{ color: "var(--fg-faint)", fontSize: ".875rem" }}>@{trader.handle}</span>
          </Link>
        </div>

        <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
          <Metric k="Call" v={cents(price.call)} tone="up" />
          <Metric k="Put" v={cents(price.put)} tone="down" />
          <Metric k="Volume" v={usd(market.volume)} />
          <Metric k={closed ? "Closed" : "Closes in"} v={closed ? market.status : countdown(market.closesAt)} />
        </div>
      </div>

      {/* -------------------------------------------------- body + panel */}
      <div style={{ display: "grid", gap: "var(--s-6)", gridTemplateColumns: "minmax(0,1fr) minmax(0,400px)", marginTop: "var(--s-8)", alignItems: "start" }} className="split">

        {/* ======================== LEFT COLUMN ======================== */}
        <div style={{ display: "grid", gap: "var(--s-4)" }}>

          {/* 1. CALL PRICE panel */}
          <Panel>
            <PanelHead
              left={<>
                <div className="eyebrow">Call price</div>
                <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-.03em", marginTop: 2 }}>
                  {cents(price.call)}
                </div>
              </>}
              right={<>
                <div className="eyebrow" style={{ textAlign: "right" }}>Spot</div>
              </>}
            />
            <div style={{ marginTop: "var(--s-4)" }}>
              <Chart points={pricePoints} w={760} h={160} showBaseline={false} strokeWidth={2} />
            </div>
          </Panel>

          {/* 2. UNDERLYING · TOTAL PNL panel */}
          <Panel>
            <PanelHead
              left={<>
                <div className="eyebrow">Underlying · total PnL</div>
                <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-.03em", marginTop: 2 }}>
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
              <Chart points={history["30d"].length ? history["30d"] : history.all} w={760} h={230} showAxis strokeWidth={2} />
            </div>
            <p style={{ margin: "var(--s-3) 0 0", fontSize: ".8125rem", color: "var(--fg-faint)" }}>
              Every snapshot behind this settlement is published to the evidence record.
              The same data source a reader can verify is the only input the resolver ever sees.
            </p>
          </Panel>

          {/* 3. Resolution section */}
          <div style={{ paddingTop: "var(--s-6)" }}>
            <h3 style={{ fontSize: "var(--step-1)", fontWeight: 600, fontFamily: "var(--font-display)", letterSpacing: "-.02em", marginBottom: "var(--s-4)" }}>
              Resolution
            </h3>
            <dl style={{ display: "grid", gap: 0, fontSize: ".875rem", margin: 0 }}>
              <DefRow k="Settles on" v={`Sign of ${windowShort} PnL`} />
              <DefRow k="Settlement value" v="Median of the final 3 snapshots" />
              <DefRow k="Opened" v={fmtDateUTC(market.opensAt)} />
              <DefRow k="Closes" v={fmtDateUTC(market.closesAt)} />
              <DefRow k="Dispute window" v="2 hours after proposal" />
              <DefRow k="Collateral" v="USDG · chain 4663" />
            </dl>
            <p style={{ marginTop: "var(--s-4)", fontSize: ".8125rem", color: "var(--fg-faint)", lineHeight: 1.6 }}>
              This market settles automatically from the published snapshot record.
              If three readings around the close show PnL above the strike, call holders are paid; otherwise put holders are.
              A void refunds all positions at cost.
            </p>
          </div>

          {/* 4. Book section */}
          <div style={{ paddingTop: "var(--s-4)", borderTop: "1px solid var(--border-subtle)" }}>
            <h3 style={{ fontSize: "var(--step-1)", fontWeight: 600, fontFamily: "var(--font-display)", letterSpacing: "-.02em", marginBottom: "var(--s-4)" }}>
              Book
            </h3>
            <dl style={{ display: "grid", gap: 0, fontSize: ".875rem", margin: 0 }}>
              <DefRow k="Seeded liquidity" v={usd(market.seed)} />
              <DefRow k="Traded volume" v={usd(market.volume)} />
              <DefRow k="Call reserve" v={usd(market.reserves.call)} />
              <DefRow k="Put reserve" v={usd(market.reserves.put)} />
            </dl>
          </div>
        </div>

        {/* ===================== RIGHT COLUMN (sticky sidebar) ===================== */}
        <div style={{
          position: "sticky", top: "calc(var(--nav-h) + 16px)",
          padding: "var(--s-5)", borderRadius: "var(--r-xl)",
          background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-3)",
        }}>
          {/* Question echo */}
          <p style={{ fontSize: ".9375rem", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "var(--s-4)", lineHeight: 1.45 }}>
            {question}
          </p>

          {/* Side toggle */}
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
                  <div style={{ fontWeight: 600, fontSize: ".9375rem" }}>{isCall ? "↑ Call" : "↓ Put"}</div>
                  <div className="num" style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: 2 }}>{cents(price[s])}</div>
                  <div className="num" style={{ fontSize: ".75rem", opacity: .7 }}>{shown[s].toFixed(2)}x</div>
                </button>
              );
            })}
          </div>

          {/* You pay */}
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: "var(--s-3)", marginTop: "var(--s-5)",
          }}>
            <div className="eyebrow">You pay</div>
            {live && wallet.address && (
              <button
                onClick={() => { void wallet.refreshBalance(); }}
                title={`${wallet.address} — click to refresh`}
                style={{
                  border: "none", background: "transparent", padding: 0, cursor: "pointer",
                  fontFamily: "inherit", fontSize: ".75rem", color: "var(--fg-faint)",
                }}
              >
                <span className="num">
                  {wallet.balance == null ? "balance…" : `${wallet.balance.toFixed(2)} USDG`}
                </span>
                <span style={{ marginLeft: 6 }}>{short(wallet.address)}</span>
              </button>
            )}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginTop: "var(--s-2)",
            padding: "16px 16px", borderRadius: "var(--r-md)",
            border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)",
          }}>
            <span className="num" style={{ color: "var(--fg)", fontSize: "1.625rem", fontWeight: 500, letterSpacing: "-.03em" }}>$</span>
            <input type="number" min={0} step={1} value={amount}
              placeholder="0"
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
              fontSize: ".75rem", fontWeight: 600, color: "var(--fg-faint)",
              padding: "4px 9px", borderRadius: "var(--r-full)", background: "var(--surface-raised)",
              border: "1px solid var(--border-subtle)",
            }}>USDG</span>
          </div>

          {/* Presets */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: "var(--s-2)" }}>
            {PRESETS.map((v) => (
              <button key={v} onClick={() => setAmount(v)} className="num" style={{
                padding: "9px 2px", borderRadius: "var(--r-md)", cursor: "pointer",
                border: `1px solid ${amount === v ? "var(--accent)" : "var(--border-subtle)"}`,
                background: amount === v ? "var(--accent-quiet)" : "transparent",
                color: amount === v ? "var(--accent)" : "var(--fg-muted)",
                fontSize: ".8125rem", fontFamily: "inherit", fontWeight: 600,
              }}>${v}</button>
            ))}
          </div>

          {/* Quote breakdown */}
          <dl style={{ margin: "var(--s-5) 0 0", display: "grid", gap: 0, fontSize: ".875rem" }}>
            <Row k="Shares" v={quote ? quote.shares.toFixed(2) : "—"} />
            <Row k="Average price" v={quote ? cents(quote.avgPrice) : "—"} />
            <Row k="Price impact" v={quote ? `${(impact * 100).toFixed(2)}%` : "—"} tone={tooBig ? "var(--down)" : undefined} />
            <Row k={`Fee (${FEE_BPS / 100}% of winnings)`} v={quote ? usd(fee) : "—"} />
            <Row k="Payout multiple" v={quote ? `${payoutMult.toFixed(2)}x` : "—"} />
            <Row k="If you're right" v={quote ? usd(net) : "—"} strong tone="var(--up)" />
          </dl>

          {/* Buy button */}
          {(() => {
            const dead = closed || tooBig || shortOfFunds || fundingPaused;
            const disabled =
              busy || closed || !quote || tooBig || stake <= 0 || shortOfFunds ||
              fundingPaused || treasury === null || wallet.connecting;
            return (
              <button onClick={submit} disabled={disabled} style={{
                width: "100%", marginTop: "var(--s-5)", padding: "15px",
                borderRadius: "var(--r-md)", border: "none",
                cursor: dead ? "not-allowed" : busy ? "progress" : "pointer",
                background: dead ? "var(--surface-sunken)" : "var(--accent)",
                color: dead ? "var(--fg-faint)" : "var(--accent-contrast)",
                fontWeight: 600, fontSize: "1rem", fontFamily: "inherit",
                boxShadow: dead ? "none" : "var(--shadow-accent)",
              }}>
                {closed ? `Market ${market.status}`
                  : phase === "checking" ? "Checking capacity…"
                  : phase === "signing" ? "Confirm in your wallet…"
                  : phase === "confirming" ? "Waiting for confirmation…"
                  : phase === "filling" ? "Filling…"
                  : fundingPaused ? "Treasury is being funded"
                  : wallet.connecting ? "Connecting…"
                  : stake <= 0 ? "Enter an amount"
                  : tooBig ? "Size too large for this book"
                  : shortOfFunds ? "Not enough USDG"
                  : needsWallet ? "Connect wallet"
                  : `Buy ${side === "call" ? "Call" : "Put"} · ${usd(stake)}`}
              </button>
            );
          })()}

          {fundingPaused && (
            <p style={{ marginTop: "var(--s-3)", fontSize: ".8125rem", color: "var(--fg-muted)", lineHeight: 1.55 }}>
              New positions reopen once collateral is in place. Positions you already
              hold are unaffected, and payouts settle as normal.
            </p>
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

          {msg && msg.kind === "refund" && (
            <div style={{
              marginTop: "var(--s-4)", padding: "var(--s-4)", borderRadius: "var(--r-md)",
              background: "var(--surface-sunken)", border: "1px solid var(--border-strong)",
              lineHeight: 1.55,
            }}>
              <div style={{ fontSize: ".9375rem", fontWeight: 600, color: "var(--fg)" }}>
                {REFUND_PENDING.test(msg.text) ? "Your payment is being refunded" : "Your stake was returned"}
              </div>
              <p style={{ margin: "6px 0 0", fontSize: ".8125rem", color: "var(--fg-muted)" }}>
                {msg.text}
              </p>
              {msg.tx && (
                <a href={explorerTx(msg.tx)} target="_blank" rel="noreferrer" style={{
                  display: "inline-block", marginTop: "var(--s-2)",
                  fontSize: ".8125rem", fontWeight: 600, color: "var(--accent)",
                }}>
                  {REFUND_PENDING.test(msg.text) ? "View the payment on chain" : "View the refund on chain"}
                </a>
              )}
            </div>
          )}

          {msg && msg.kind !== "refund" && (
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
          <p style={{
            marginTop: "var(--s-3)", fontSize: ".75rem", lineHeight: 1.5,
            // a disclosure is meant to be read, so it sits one step clearer
            // than the boilerplate around it - muted, never alarming
            color: live && manualSettlement ? "var(--fg-muted)" : "var(--fg-faint)",
          }}>
            {treasury === null
              ? "Checking how this book settles…"
              : !live
              ? "This deployment is not configured to take real money — positions here are booked without a payment."
              : manualSettlement
              ? "Stakes are paid in USDG on Robinhood Chain. Every position is recorded on chain: the payment transaction is visible in the explorer, and settlement runs on published snapshots anyone can check. Winnings are settled by the operator after the market closes, and may not be instant."
              : "Stakes are paid in USDG on Robinhood Chain. Every position is recorded on chain: the payment transaction is visible in the explorer, and settlement runs on published snapshots anyone can check. Winnings are paid back to the same wallet from the treasury once the market settles."}
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

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    padding: "var(--s-5)", borderRadius: "var(--r-xl)",
    background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
    boxShadow: "var(--shadow-2)",
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
