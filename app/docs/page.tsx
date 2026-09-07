import Link from "next/link";
import Reveal from "@/components/Reveal";
import DocsNav from "@/components/DocsNav";
import MedianDiagram from "@/components/MedianDiagram";
import {
  FEE_BPS, FEE_SPLIT, MAX_SNAPSHOT_AGE_MS, SETTLEMENT_SNAPSHOTS, RESOLVER_GRACE_MS,
} from "@/lib/settlement";
import { SEED_PER_MARKET, ROSTER_SIZE, WINDOWS } from "@/lib/markets";
import { usd, cents } from "@/lib/format";

export const metadata = { title: "Docs · fomo market" };

const SECTIONS: [string, string][] = [
  ["idea", "The idea"],
  ["underlying", "What settles a market"],
  ["prices", "Where the number comes from"],
  ["resolution", "Snapshots and the median rule"],
  ["odds", "How the odds open"],
  ["amm", "How the price moves"],
  ["payout", "What you get paid"],
  ["void", "When a market voids"],
  ["traders", "If you are the subject"],
  ["params", "Parameters"],
  ["glossary", "Glossary"],
];

export default function Docs() {
  return (
    <div className="wrap" style={{ paddingTop: "var(--s-12)", paddingBottom: "var(--section-y)" }}>
      <div style={{ display: "grid", gap: "var(--s-12)", gridTemplateColumns: "240px minmax(0,1fr)" }} className="split">
        <DocsNav sections={SECTIONS} />

        <article style={{ maxWidth: "70ch" }}>
          <div className="eyebrow">Documentation</div>
          <h1 style={{ fontSize: "var(--step-4)", marginTop: "var(--s-3)" }}>How fomo market works</h1>
          <p style={{ fontSize: "var(--step-1)", color: "var(--fg-muted)", marginTop: "var(--s-4)", lineHeight: 1.6 }}>
            Everything below describes what the code actually does. Where a rule
            exists to close off a specific way of losing money, the rule is
            written down with the reason attached to it.
          </p>

          <S id="idea" n={1} title="The idea">
            <P>
              A trader with a public record is already being priced informally —
              in who copies them, in who quietly stops. fomo market turns that into a
              contract with a settlement rule attached.
            </P>
            <P>
              The instrument is a binary option. One side pays 1 USDG per share,
              the other pays nothing, and which is which comes down to a single
              number measured at two moments. The subject is an account, not an
              asset: you are not taking a view on what they hold, but on whether
              they end the window ahead of where they started.
            </P>
          </S>

          <S id="underlying" n={2} title="What settles a market">
            <P>
              Every market settles on <B>cumulative account PnL</B> — a signed
              dollar figure for how far ahead or behind an account is across its
              whole history.
            </P>
            <Callout tone="down" title="Why not portfolio value">
              Someone who deposits ten thousand dollars an hour before the close
              would push their portfolio value up without having traded, and
              every call holder would be paid on a bank transfer. Cumulative PnL
              is already net of flows: money in is not profit, so only closed
              trades move it.
            </Callout>
          </S>

          <S id="prices" n={3} title="Where the number comes from">
            <P>
              A keeper reads the source on a fixed cadence and writes each read
              to its own file: when it happened, where it came from, and every
              listed handle with its PnL. Those files are the evidence, and
              nothing downstream reads anything else.
            </P>
            <P>
              Two constraints on the parser carry weight. An abbreviated figure
              is rejected outright — at <Code>$6.8M</Code> of precision a whole
              day of movement can round away, settling both ends of a window to
              the same number and paying the wrong side. And a failed read is
              recorded as a gap rather than back-filled, because a keeper that
              was asleep observed nothing and should not pretend otherwise.
            </P>
            <P>
              The record is served back at{" "}
              <Link href="/api/snapshots" style={{ color: "var(--accent)", fontWeight: 500 }}>/api/snapshots</Link>.
              Committing the hash of a file nobody can fetch would prove nothing
              to anyone.
            </P>
          </S>

          <S id="resolution" n={4} title="Snapshots and the median rule">
            <P>
              Each end of a market is the median of the {SETTLEMENT_SNAPSHOTS}{" "}
              readings nearest that moment, never a single print.
            </P>
            <MedianDiagram />
            <Pre>{`strike  = median(${SETTLEMENT_SNAPSHOTS} readings nearest open)
settle  = median(${SETTLEMENT_SNAPSHOTS} readings nearest close)
winner  = settle > strike ? call : put`}</Pre>
            <P>
              A reading more than {MAX_SNAPSHOT_AGE_MS / 60000} minutes from the
              moment being valued is not eligible at all. Fewer than{" "}
              {SETTLEMENT_SNAPSHOTS} eligible readings at either end and the
              market voids instead of resolving. Note the strict inequality: a
              window that ends exactly where it began resolves to the put.
            </P>
          </S>

          <S id="odds" n={5} title="How the odds open">
            <P>
              A market seeded at an even split claims both sides are equally
              likely, which the record usually contradicts. Instead the opening
              price is the model&apos;s probability that cumulative PnL is higher at
              the close than at the open.
            </P>
            <P>
              Treating PnL as a walk with drift <Code>μ</Code> and per-step
              volatility <Code>σ</Code> over <Code>n</Code> steps, that is{" "}
              <Code>P = Φ(μ√n / σ)</Code>. Crypto returns are fat-tailed, so a
              normal tail overstates how confident the estimate deserves to be;
              a Student-t with four degrees of freedom pulls the answer back
              toward even, which is the conservative direction for a book that
              has to quote both sides. Prices are clamped to 15–85¢ so neither
              side becomes untradeable.
            </P>
          </S>

          <S id="amm" n={6} title="How the price moves">
            <P>
              Each market is a fixed-product pool holding a reserve of each
              outcome. Collateral mints one of each outcome token — a call and a
              put together are always worth exactly 1, since exactly one pays —
              and a purchase withdraws the wanted side, sized so the product of
              the reserves is unchanged.
            </P>
            <P>
              Price is the ratio between reserves, which is why price and implied
              probability are the same number: a call at {cents(0.43)} is the
              book saying 43%. Both sides always sum to 1.
            </P>
            <Callout tone="accent" title="Depth is sized against the ticket">
              Seeded depth is {usd(SEED_PER_MARKET, 0)} per market. That is not
              arbitrary: at {usd(10, 0)} of depth a {usd(100, 0)} buy fills
              roughly 42¢ away from the quoted price, which makes the multiple
              on the card a number nobody actually receives. A fill more than 5¢
              from the quote is refused outright.
            </Callout>
          </S>

          <S id="payout" n={7} title="What you get paid">
            <P>
              A winning share redeems for exactly 1 USDG; a losing share is
              worth nothing. The fee is {FEE_BPS / 100}% and it is charged{" "}
              <B>on winnings only</B>, at redemption. A position that loses pays
              no fee, because there is nothing to take a fee from.
            </P>
            <Ticket />
            <P>
              This is also why a flat book quotes 1.98x rather than 2.00x: the
              multiple on every card is what lands in the wallet after the fee,
              not the gross ratio before it.
            </P>
            <FeeSplit />
          </S>

          <S id="void" n={8} title="When a market voids">
            <P>
              A void refunds every position at cost. It is not a failure mode —
              it is the right outcome whenever the evidence cannot support a
              settlement, and strictly better for a position holder than being
              resolved against a number that cannot be defended.
            </P>
            <div style={{ display: "grid", gap: "var(--s-3)", marginTop: "var(--s-5)" }}>
              {([
                ["Evidence gap", `Fewer than ${SETTLEMENT_SNAPSHOTS} eligible readings at either end of the window.`],
                ["Resolver stale", `Nobody resolved within ${RESOLVER_GRACE_MS / 864e5} days of the close, after which anyone may void it.`],
                ["Subject opted out", "The account signed to delist itself; every open market on that handle voids."],
                ["Guardian", "A separate key can stop a market that should not settle."],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{
                  display: "grid", gridTemplateColumns: "160px 1fr", gap: "var(--s-4)",
                  padding: "var(--s-4)", borderRadius: "var(--r-md)",
                  border: "1px solid var(--border-subtle)", background: "var(--surface-raised)",
                }}>
                  <span style={{ fontWeight: 600, fontSize: ".9375rem" }}>{k}</span>
                  <span style={{ color: "var(--fg-muted)", fontSize: ".9375rem", lineHeight: 1.6 }}>{v}</span>
                </div>
              ))}
            </div>
          </S>

          <S id="traders" n={9} title="If you are the subject">
            <P>
              Listing does not ask permission, so a market can exist on you
              without your involvement. Two things follow, and both are
              implemented rather than promised.
            </P>
            <P>
              You can leave. One signature delists you, voids every open market
              on your handle, and refunds each position at cost — no negotiation
              step, nothing to opt into first.
            </P>
            <P>
              There is also an escrow that accrues to your handle whether or not
              you have heard of any of this. Its share is currently{" "}
              {FEE_SPLIT.traderEscrow}%
              {FEE_SPLIT.traderEscrow === 0
                ? ", so nothing is accruing"
                : " of every fee taken at redemption"}; this page reads
              that constant rather than restating it, so it will say otherwise
              the moment it changes.
            </P>
          </S>

          <S id="params" n={10} title="Parameters">
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", overflow: "hidden", marginTop: "var(--s-4)" }}>
              {([
                ["Listed accounts", `${ROSTER_SIZE}`, "top of the source leaderboard"],
                ["Windows", WINDOWS.join(" · "), "per account"],
                ["Markets live", `${ROSTER_SIZE * WINDOWS.length}`, ""],
                ["Collateral", "USDG", ""],
                ["Redemption fee", `${FEE_BPS / 100}%`, "of winnings, never on entry"],
                ["Fee split", `${FEE_SPLIT.burn} / ${FEE_SPLIT.holders} / ${FEE_SPLIT.traderEscrow} / ${FEE_SPLIT.liquidity}`, "burn / holders / escrow / liquidity"],
                ["Underlying", "Cumulative account PnL", "signed, in dollars"],
                ["Snapshot cadence", "5 min", "288 readings a day"],
                ["Strike and settlement", `median of ${SETTLEMENT_SNAPSHOTS}`, "nearest the open and the close"],
                ["Max snapshot age", `${MAX_SNAPSHOT_AGE_MS / 60000} min`, "older cannot value a moment"],
                ["Opening price", "15–85¢", "from the account's own record"],
                ["Seed per market", usd(SEED_PER_MARKET, 0), ""],
                ["Max slippage", "5¢", "from the quoted price"],
                ["Resolver grace", `${RESOLVER_GRACE_MS / 864e5} days`, "then anyone may void"],
              ] as [string, string, string][]).map(([k, v, note], i) => (
                <div key={k} style={{
                  display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--s-4)",
                  padding: "13px 16px", fontSize: ".9375rem", alignItems: "baseline",
                  background: i % 2 ? "var(--surface-sunken)" : "transparent",
                }}>
                  <span>
                    <span style={{ color: "var(--fg)" }}>{k}</span>
                    {note && <span style={{ color: "var(--fg-faint)", fontSize: ".8125rem", display: "block" }}>{note}</span>}
                  </span>
                  <span className="num" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{v}</span>
                </div>
              ))}
            </div>
          </S>

          <S id="glossary" n={11} title="Glossary">
            <div style={{ display: "grid", gap: "var(--s-4)", marginTop: "var(--s-4)", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              {([
                ["Cumulative account PnL", "How far an account is up or down over its whole history. The underlying every market settles on."],
                ["Snapshot", "One reading of the source, kept as a file with its time and origin."],
                ["Keeper", "The service that takes those readings and serves them back."],
                ["Strike", "The value at the open, committed as the market's record of where it started."],
                ["Median rule", "Both ends are the median of the three nearest readings, so no single one decides anything."],
                ["Call / Put", "The two sides: the call pays if PnL is higher at the close, the put if it is not."],
                ["Binary", "A contract worth exactly 1 unit of collateral if its condition holds, nothing if it does not."],
                ["Void", "A refund at cost, used whenever the evidence cannot support a settlement."],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ padding: "var(--s-4)", borderRadius: "var(--r-md)", background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontWeight: 600, fontSize: ".9375rem" }}>{k}</div>
                  <p style={{ margin: "6px 0 0", fontSize: ".875rem", color: "var(--fg-muted)", lineHeight: 1.55 }}>{v}</p>
                </div>
              ))}
            </div>
          </S>
        </article>
      </div>
      <style>{`@media (max-width: 940px){ .split{grid-template-columns:1fr !important} }`}</style>
    </div>
  );
}

function S({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <Reveal as="section" id={id} style={{ marginTop: "var(--s-16)", scrollMarginTop: "calc(var(--nav-h) + 24px)" }}>
      <div className="eyebrow">{String(n).padStart(2, "0")}</div>
      <h2 style={{ fontSize: "var(--step-2)", marginTop: "var(--s-2)" }}>{title}</h2>
      <div style={{ marginTop: "var(--s-4)" }}>{children}</div>
    </Reveal>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: "var(--fg-muted)", lineHeight: 1.75, marginTop: "var(--s-4)" }}>{children}</p>
);
const B = ({ children }: { children: React.ReactNode }) => (
  <strong style={{ color: "var(--fg)", fontWeight: 600 }}>{children}</strong>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <code style={{
    fontFamily: "var(--font-mono)", fontSize: ".875em", padding: "2px 6px",
    borderRadius: "var(--r-xs)", background: "var(--surface-sunken)",
    border: "1px solid var(--border-subtle)",
  }}>{children}</code>
);
const Pre = ({ children }: { children: string }) => (
  <pre style={{
    margin: "var(--s-5) 0 0", padding: "var(--s-5)", borderRadius: "var(--r-md)",
    background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)",
    fontFamily: "var(--font-mono)", fontSize: ".8125rem", lineHeight: 1.85,
    color: "var(--fg-muted)", overflowX: "auto",
  }}>{children}</pre>
);

function Callout({ tone, title, children }: { tone: "up" | "down" | "accent"; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: "var(--s-5)", padding: "var(--s-5)", borderRadius: "var(--r-md)",
      background: `var(--${tone}-quiet)`, borderLeft: `3px solid var(--${tone})`,
    }}>
      <div style={{ fontWeight: 600, fontSize: ".9375rem", color: `var(--${tone})` }}>{title}</div>
      <p style={{ margin: "8px 0 0", color: "var(--fg-muted)", lineHeight: 1.7, fontSize: ".9375rem" }}>{children}</p>
    </div>
  );
}

/** Worked example, computed from the live constants rather than typed in. */
function Ticket() {
  const stake = 100, price = 0.43;
  const shares = stake / price;
  const winnings = shares - stake;
  const fee = (winnings * FEE_BPS) / 10_000;

  const row = (k: string, sub: string, v: string, tone?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s-4)", padding: "11px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <span>
        <span style={{ display: "block", fontSize: ".9375rem" }}>{k}</span>
        <span style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>{sub}</span>
      </span>
      <span className="num" style={{ fontWeight: 600, whiteSpace: "nowrap", color: tone ?? "var(--fg)" }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      marginTop: "var(--s-5)", padding: "var(--s-5)", borderRadius: "var(--r-lg)",
      background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
      boxShadow: "var(--shadow-2)",
    }}>
      <div className="eyebrow">A {usd(stake, 0)} ticket at {cents(price)}</div>
      <div style={{ marginTop: "var(--s-3)" }}>
        {row("Shares", "each redeems for 1 USDG if it lands", shares.toFixed(2))}
        {row("Gross", "if the call lands", usd(shares))}
        {row("Fee", `${FEE_BPS / 100}% of ${usd(winnings)} winnings`, `−${usd(fee)}`)}
        {row("Net", "what reaches the wallet", usd(shares - fee), "var(--up)")}
        {row("If wrong", "binary, so the stake is gone", usd(0), "var(--down)")}
      </div>
    </div>
  );
}

function FeeSplit() {
  const parts: [string, number, string][] = [
    ["Burn", FEE_SPLIT.burn, "var(--accent)"],
    ["Holders", FEE_SPLIT.holders, "var(--up)"],
    ["Liquidity", FEE_SPLIT.liquidity, "var(--fg-faint)"],
  ];
  return (
    <div style={{ marginTop: "var(--s-5)" }}>
      <div style={{ display: "flex", height: 10, borderRadius: "var(--r-full)", overflow: "hidden", gap: 2 }}>
        {parts.map(([k, v, c]) => (
          <div key={k} style={{ width: `${v}%`, background: c }} title={`${k} ${v}%`} />
        ))}
      </div>
      <div style={{ display: "flex", gap: "var(--s-4)", marginTop: "var(--s-3)", flexWrap: "wrap" }}>
        {parts.map(([k, v, c]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".8125rem", color: "var(--fg-muted)" }}>
            <i style={{ width: 9, height: 9, borderRadius: 3, background: c }} />
            {k} <span className="num" style={{ fontWeight: 600, color: "var(--fg)" }}>{v}%</span>
          </span>
        ))}
        <span style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>
          subject escrow {FEE_SPLIT.traderEscrow}%
        </span>
      </div>
    </div>
  );
}
