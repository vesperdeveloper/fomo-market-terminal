import Link from "next/link";
import Reveal from "@/components/Reveal";
import DocsNav from "@/components/DocsNav";
import MedianDiagram from "@/components/MedianDiagram";
import {
  FEE_BPS, FEE_SPLIT, MAX_SNAPSHOT_AGE_MS, SETTLEMENT_SNAPSHOTS, RESOLVER_GRACE_MS,
} from "@/lib/settlement";
import { ROSTER_SIZE, WINDOWS } from "@/lib/markets";
import { multiple } from "@/lib/pool";
import { usd, cents } from "@/lib/format";

export const metadata = { title: "Docs · fomo market" };

const SECTIONS: [string, string][] = [
  ["idea", "The idea"],
  ["underlying", "What settles a market"],
  ["prices", "Where the number comes from"],
  ["resolution", "Snapshots and the median rule"],
  ["odds", "Where the odds come from"],
  ["contract", "The contract"],
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

          <S id="odds" n={5} title="Where the odds come from">
            <P>
              There is no market maker here and no seeded liquidity. A market is
              a pot: both sides stake into it, and the winning side is paid out
              of it. That is the whole mechanism, and it is the reason the
              contract can never owe more than it is holding.
            </P>
            <Pre>{`price(up)    = staked_up / pot
multiple(up) = 1 + (stake / (staked_up + stake)) * staked_down * (1 - fee) / stake`}</Pre>
            <P>
              So the odds are not a model&apos;s opinion — they are the book. A side
              holding a quarter of the pot is the book saying 25%, and paying
              close to 4x if it lands. Your own ticket is already inside the
              denominator, which is why a large stake on a thin side quotes worse
              than a small one: you are sharing the same losing pot with yourself.
            </P>
            <Callout tone="accent" title="Why not an automated market maker">
              An AMM quotes both sides continuously, which is nicer to trade
              against — but every quote it gives is a promise the pool has to be
              able to honour, and honouring it needs real collateral sitting
              there before the first ticket. A venue that seeds that liquidity
              out of thin air is writing cheques against money that does not
              exist, and the first winning session is when everybody finds out.
            </Callout>
            <Callout tone="down" title="What you give up">
              A pot has no counterparty to sell back to, so there is no closing a
              position early. A ticket is held to the close, or it is voided.
            </Callout>
          </S>

          <S id="contract" n={6} title="The contract">
            <P>
              Every market is a numbered entry in one contract on Robinhood
              Chain, and every stake is USDG the contract is holding. The site
              never touches the money: staking is a transaction you sign to the
              contract, and collecting is a transaction you sign to the contract.
              There is no state in which a payout is waiting on an operator.
            </P>
            <Pre>{`openMarket(handle, window, opensAt, closesAt, strike)   // oracle
stake(marketId, side, amount)                          // you
resolve(marketId, settleValue)                         // oracle
claim(marketId)                                        // you
voidStale(marketId)                                    // anybody, after 7 days`}</Pre>
            <P>
              The oracle publishes two numbers and nothing else. It cannot move a
              stake, cannot pay itself, and cannot resolve a market that has not
              closed — not by policy, but because the contract offers it no
              function that would. If it disappears entirely, anyone at all can
              void a market {RESOLVER_GRACE_MS / 864e5} days after its close and
              every stake comes back at cost.
            </P>
            <Callout tone="up" title="The invariant">
              A claim pays a winner their stake plus their share of the losing
              pot. Summed across every winner that is at most the pot itself, so
              the contract is solvent by arithmetic rather than by promise.
            </Callout>
          </S>

          <S id="payout" n={7} title="What you get paid">
            <P>
              A winner takes back their stake plus their share of the losing pot,
              in proportion to what they staked. A loser gets nothing. The fee is{" "}
              {FEE_BPS / 100}% and it is charged <B>on winnings only</B>, at the
              claim — a position that loses pays no fee, because there is nothing
              to take a fee from.
            </P>
            <Ticket />
            <P>
              The multiple shown on every card and ticket is already net of that
              fee: it is what the contract would actually pay, not a gross ratio
              somebody still has to be talked out of.
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
                ["One-sided", "Nobody took the other side, so there is nothing to win. The contract voids it at the close rather than handing one side a free round trip."],
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
              You can leave. <Code>setBlocked</Code> on the contract refuses every
              new market on your handle, the oracle voids the open ones, and each
              stake is refunded at cost — no negotiation step, nothing to opt into
              first.
            </P>
            <P>
              There is also an escrow that accrues to your handle whether or not
              you have heard of any of this: {FEE_SPLIT.traderEscrow}% of every
              fee the contract takes, held under a hash of your handle from the
              first ticket. It is not a promise on this page — it is a balance in
              the contract, and <Code>claimEscrow</Code> pays it out to the
              address bound to that handle.
            </P>
          </S>

          <S id="params" n={10} title="Parameters">
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", overflow: "hidden", marginTop: "var(--s-4)" }}>
              {([
                ["Listed accounts", `${ROSTER_SIZE}`, "top of the source leaderboard"],
                ["Windows", WINDOWS.join(" · "), "per account"],
                ["Markets live", `${ROSTER_SIZE * WINDOWS.length}`, ""],
                ["Collateral", "USDG", ""],
                ["Fee", `${FEE_BPS / 100}%`, "of winnings, never on entry"],
                ["Fee split", `${FEE_SPLIT.traderEscrow} / ${FEE_SPLIT.venue}`, "subject escrow / venue"],
                ["Underlying", "Cumulative account PnL", "signed, in dollars"],
                ["Snapshot cadence", "5 min", "288 readings a day"],
                ["Strike and settlement", `median of ${SETTLEMENT_SNAPSHOTS}`, "nearest the open and the close"],
                ["Max snapshot age", `${MAX_SNAPSHOT_AGE_MS / 60000} min`, "older cannot value a moment"],
                ["Book", "parimutuel pot", "no maker, no seeded liquidity"],
                ["Seed per market", "none", "the only money in a pot is staked money"],
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
                ["Up / Down", "The two sides: up wins if PnL is higher at the close, down if it is not."],
                ["Parimutuel", "A pot both sides stake into, where the winners split the losers\u2019 money in proportion to what they staked."],
                ["Pot", "Everything staked on a market, on both sides. The number the winning side is paid out of."],
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
  const stake = 100, potMine = 160, potOther = 240;
  const mult = multiple({ call: potMine, put: potOther }, "call", stake);
  const gross = stake * mult;
  const winnings = gross - stake;
  const fee = (winnings / (1 - FEE_BPS / 10_000)) * (FEE_BPS / 10_000);

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
    }}>
      <div className="eyebrow">A {usd(stake, 0)} ticket on up</div>
      <div style={{ marginTop: "var(--s-3)" }}>
        {row("The pot when you arrive", `${usd(potMine, 0)} up · ${usd(potOther, 0)} down`, usd(potMine + potOther, 0))}
        {row("Your share of the up side", "after your own ticket is counted", `${((stake / (potMine + stake)) * 100).toFixed(1)}%`)}
        {row("Fee", `${FEE_BPS / 100}% of ${usd(winnings)} winnings`, `\u2212${usd(fee)}`)}
        {row("If up wins", "claimed by you, from the contract", usd(gross), "var(--up)")}
        {row("If down wins", "binary, so the stake is gone", usd(0), "var(--down)")}
      </div>
    </div>
  );
}

function FeeSplit() {
  const parts: [string, number, string][] = [
    ["Subject escrow", FEE_SPLIT.traderEscrow, "var(--accent)"],
    ["Venue", FEE_SPLIT.venue, "var(--fg-faint)"],
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
          both split in the contract, at the claim
        </span>
      </div>
    </div>
  );
}
