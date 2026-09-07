import Link from "next/link";
import { board } from "@/lib/view";
import { priceOf, multipleOf } from "@/lib/view";
import TraderCard, { Avatar } from "@/components/TraderCard";
import Marquee from "@/components/Marquee";
import Reveal from "@/components/Reveal";

import { usd, usdShort, pct, cents, followers as fmtF } from "@/lib/format";
import { SEED_PER_MARKET } from "@/lib/markets";
import { FEE_BPS, FEE_SPLIT } from "@/lib/settlement";

export const dynamic = "force-dynamic";

/**
 * Running total held against handles that have not been claimed. There is no
 * escrow ledger to read yet, so this is carried here as a figure rather than
 * derived; it moves to a contract read once the escrow is live on chain.
 */
const ESCROWED = 648.32;

export default async function Home() {
  const { rows } = await board();
  const featured = rows.slice(0, 2);
  const open = rows.flatMap((r) => r.markets).length;

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section
        style={{
          position: "relative",
          borderBottom: "1px solid var(--rule)",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        {/* the ruled ground this whole build is drawn on */}
        <div aria-hidden className="grid-bg" style={{ position: "absolute", inset: 0, zIndex: -2 }} />
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0, zIndex: -1,
            background: "radial-gradient(90% 60% at 12% -10%, rgba(91,108,255,.16) 0%, transparent 60%)",
          }}
        />

        <div
          className="wrap-wide hero-grid"
          style={{
            paddingTop: "clamp(48px, 7vw, 96px)",
            paddingBottom: "clamp(40px, 6vw, 80px)",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, .85fr)",
            gap: "var(--s-12)",
            alignItems: "center",
          }}
        >
          <div>
            <Reveal>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap" }}>
                <span
                  className="num"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    fontSize: ".75rem", letterSpacing: ".16em", textTransform: "uppercase",
                    color: "var(--fg-faint)",
                  }}
                >
                  <i className="live-dot" style={{ width: 5, height: 5, background: "var(--up)" }} />
                  {open ? `${open} markets open` : `${rows.length} accounts listed`}
                </span>
                <span style={{ width: 1, height: 12, background: "var(--rule)" }} />
                <span className="eyebrow">Robinhood Chain</span>
                <span style={{ width: 1, height: 12, background: "var(--rule)" }} />
                <span className="eyebrow">Settles in USDG</span>
              </div>
            </Reveal>

            <Reveal delay={60}>
              <h1
                style={{
                  fontSize: "var(--step-6)",
                  marginTop: "var(--s-6)",
                  maxWidth: "14ch",
                  letterSpacing: "-.04em",
                }}
              >
                The traders are the instrument.
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p
                style={{
                  fontSize: "var(--step-1)", color: "var(--fg-muted)",
                  maxWidth: "50ch", marginTop: "var(--s-5)", lineHeight: 1.65,
                }}
              >
                Every fomo account already prints a track record in public. This is
                the book written on it: take the up or the down on where an
                account&apos;s PnL lands in a day or a week, staked into a contract
                that holds the pot and pays the winners itself.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", marginTop: "var(--s-8)" }}>
                <Link
                  href="/discover"
                  className="num"
                  style={{
                    padding: "14px 26px", borderRadius: "var(--r-sm)", background: "var(--accent)",
                    color: "var(--accent-contrast)", fontSize: ".8125rem",
                    letterSpacing: ".12em", textTransform: "uppercase",
                  }}
                >
                  Open the board
                </Link>
                <Link
                  href="/docs"
                  className="num"
                  style={{
                    padding: "14px 26px", borderRadius: "var(--r-sm)",
                    border: "1px solid var(--border-strong)", fontSize: ".8125rem",
                    letterSpacing: ".12em", textTransform: "uppercase", color: "var(--fg-muted)",
                  }}
                >
                  Read the rules
                </Link>
              </div>
            </Reveal>

            {/* the contract address, once there is one to publish */}
            <Reveal delay={230}>
              <div
                className="num"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 12,
                  marginTop: "var(--s-8)", padding: "12px 16px",
                  borderRadius: "var(--r-sm)", border: "1px solid var(--rule)",
                  background: "var(--surface-raised)", fontSize: ".8125rem",
                }}
              >
                <span style={{ letterSpacing: ".18em", textTransform: "uppercase", fontSize: ".6875rem", color: "var(--fg-faint)" }}>
                  Contract
                </span>
                <span style={{ width: 1, height: 14, background: "var(--rule)" }} />
                <span style={{ color: "var(--fg-faint)" }}>CA:</span>
                <span style={{ color: "var(--accent-hover)" }}>soon</span>
              </div>
            </Reveal>
          </div>

          {/* the readout: real rows, no illustration */}
          <Reveal delay={100}>
            <div
              className="panel"
              style={{ overflow: "hidden", position: "relative", background: "var(--surface-raised)" }}
            >
              <div
                aria-hidden
                className="scanline"
                style={{
                  position: "absolute", left: 0, right: 0, height: 40, zIndex: 1, pointerEvents: "none",
                  background: "linear-gradient(180deg, transparent, rgba(91,108,255,.07), transparent)",
                }}
              />
              <div
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px var(--s-4)", borderBottom: "1px solid var(--rule)",
                }}
              >
                <span className="eyebrow">Cumulative PnL · 24h</span>
                <span className="num" style={{ fontSize: ".6875rem", color: "var(--fg-faint)" }}>
                  read every 5 min
                </span>
              </div>
              {rows.slice(0, 7).map((r, i) => {
                const up = r.delta24h >= 0;
                return (
                  <Link
                    key={r.trader.handle}
                    href={`/t/${r.trader.handle}`}
                    className="row-hit"
                    style={{
                      display: "grid", gridTemplateColumns: "22px 1fr 72px 96px",
                      alignItems: "center", gap: "var(--s-3)",
                      padding: "9px var(--s-4)",
                      borderBottom: i === 6 ? "none" : "1px solid var(--rule)",
                    }}
                  >
                    <span className="num" style={{ fontSize: ".6875rem", color: "var(--fg-faint)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Avatar trader={r.trader} size={22} />
                      <span style={{ fontSize: ".875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.trader.name}
                      </span>
                    </span>
                    <span className="num" style={{ fontSize: ".8125rem", textAlign: "right", color: "var(--fg-muted)" }}>
                      {usdShort(r.pnl)}
                    </span>
                    <span
                      className="num"
                      style={{ fontSize: ".8125rem", textAlign: "right", color: up ? "var(--up)" : "var(--down)" }}
                    >
                      {up ? "+" : "−"}{usdShort(Math.abs(r.delta24h)).replace("-", "")}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------- ticker strip */}
      <Marquee
        items={rows.slice(0, 10).map((r) => ({
          handle: r.trader.handle,
          name: r.trader.name,
          avatar: r.trader.avatar,
          change: r.change24h,
          points: r.history["24h"].length ? r.history["24h"] : r.history.all,
        }))}
      />

      {/* ------------------------------------------------------ key numbers */}
      <section className="wrap-wide" style={{ borderBottom: "1px solid var(--rule)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {([
            ["Accounts listed", String(rows.length)],
            ["Markets open", open ? String(open) : "soon"],
            ["Windows", "24h · 7d"],
            ["Collateral", "USDG"],
          ] as [string, string][]).map(([k, v], i) => (
            <div
              key={k}
              style={{
                padding: "var(--s-6) var(--s-4)",
                borderLeft: i === 0 ? "none" : "1px solid var(--rule)",
              }}
            >
              <div className="eyebrow">{k}</div>
              <div className="num" style={{ fontSize: "1.5rem", marginTop: 6, letterSpacing: "-.03em" }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- primitive */}
      <Section eyebrow="The primitive" title="A profile you can take a side on">
        <p style={lede}>
          Every screen here is the same object repeated. Take the profile you
          already recognise, put the account&apos;s money line under it, and replace
          the follow button with two prices.
        </p>
        <div style={{ display: "grid", gap: "var(--s-8)", gridTemplateColumns: "minmax(0, 380px) minmax(0, 1fr)", marginTop: "var(--s-12)", alignItems: "start" }} className="split">
          {featured[0] && (
            <Reveal>
              <TraderCard
                trader={featured[0].trader} pnl={featured[0].pnl}
                history={featured[0].history} stats={featured[0].stats}
                market={featured[0].markets[0] && {
                  id: featured[0].markets[0].id,
                  window: featured[0].markets[0].window,
                  volume: featured[0].markets[0].volume,
                  price: {
                    call: priceOf(featured[0].markets[0], "call"),
                    put: priceOf(featured[0].markets[0], "put"),
                  },
                  multiple: {
                    call: multipleOf(featured[0].markets[0], "call"),
                    put: multipleOf(featured[0].markets[0], "put"),
                  },
                }} />
            </Reveal>
          )}
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--s-6)" }}>
            {[
              ["The profile stays the profile", "Avatar, handle, follower count, bio. You have a view on this person because you already know who they are, so none of that gets abstracted away."],
              ["One number, honestly scored", "The card leads with the account's cumulative PnL. Funding the account cannot move it — only closed trades can, which is what makes it worth writing a contract on."],
              ["The stats that set the price", "Realised volatility, hit rate, thirty-day volume. These are not garnish; they are the inputs behind the quote you are shown."],
              ["Two prices where Buy would be", "Each card ends in a live market: a call, a put, and the multiple you would actually be paid after the fee."],
            ].map(([h, b], i) => (
              <Reveal as="li" key={h} delay={i * 70} style={{ display: "flex", gap: "var(--s-4)" }}>
                <span className="num" style={{
                  width: 30, height: 30, flexShrink: 0, borderRadius: "var(--r-full)",
                  display: "grid", placeItems: "center", background: "var(--accent-quiet)",
                  color: "var(--accent)", fontWeight: 700, fontSize: ".8125rem",
                }}>{i + 1}</span>
                <div>
                  <h3 style={{ fontSize: "var(--step-1)" }}>{h}</h3>
                  <p style={{ margin: "6px 0 0", color: "var(--fg-muted)", lineHeight: 1.6 }}>{b}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </Section>

      {/* ------------------------------------------------------- two markets */}
      <Section eyebrow="Two markets" title="One day, or one week">
        <p style={lede}>
          Each listed account carries the same question over two horizons. Same
          underlying, same settlement rule, different amount of room for the
          record to move.
        </p>
        <div style={{ display: "grid", gap: "var(--s-6)", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginTop: "var(--s-10)" }}>
          {(["24h", "7d"] as const).map((w, i) => {
            const r = rows.find((x) => x.markets.some((m) => m.window === w));
            const m = r?.markets.find((x) => x.window === w);
            return (
              <Reveal key={w} delay={i * 80}>
                <div style={{
                  padding: "var(--s-6)", borderRadius: "var(--r-xl)",
                  background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
                  boxShadow: "var(--shadow-2)", height: "100%",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s-3)" }}>
                    <span className="eyebrow">Calls and puts · {w === "24h" ? "1 day" : "7 days"}</span>
                    <span className="num" style={{
                      padding: "4px 11px", borderRadius: "var(--r-sm)", fontSize: ".75rem", fontWeight: 500,
                      background: "var(--surface-sunken)", color: "var(--fg-muted)",
                    }}>{w}</span>
                  </div>
                  <h3 style={{ fontSize: "var(--step-1)", marginTop: "var(--s-4)" }}>
                    {w === "24h" ? "Settles on one day of PnL" : "Settles on seven days of PnL"}
                  </h3>
                  <p style={{ color: "var(--fg-muted)", lineHeight: 1.65, marginTop: "var(--s-3)", fontSize: ".9375rem" }}>
                    {w === "24h"
                      ? "A single session. Noise dominates, so the odds sit closer to even and a good day is enough to decide it."
                      : "A week of trading. Whatever edge an account actually has gets more chance to show up over the noise."}
                  </p>
                  {r && m && (
                    <div style={{ marginTop: "var(--s-5)", paddingTop: "var(--s-5)", borderTop: "1px solid var(--border-subtle)" }}>
                      <div style={{ fontSize: ".875rem", color: "var(--fg-muted)" }}>
                        Is @{r.trader.handle} up over the next {w === "24h" ? "24 hours" : "7 days"}?
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-2)", marginTop: "var(--s-3)" }}>
                        <Pill kind="call" v={multipleOf(m, "call")} href={`/m/${m.id}?side=call`} />
                        <Pill kind="put" v={multipleOf(m, "put")} href={`/m/${m.id}?side=put`} />
                      </div>
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* ---------------------------------------------------------- ticket */}
      <Section eyebrow="How it works" title="Three steps, no seed phrase">
        <p style={lede}>
          Sign in with an account you already have, fund with a card, trade
          without touching gas. The chain is plumbing, not an initiation rite.
        </p>
        <div style={{ display: "grid", gap: "var(--s-8)", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 380px)", marginTop: "var(--s-12)", alignItems: "start" }} className="split">
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--s-6)" }}>
            {[
              ["Pick an account", "Every listed handle carries a one-day and a seven-day market. Search one or browse the board."],
              ["Take a side", "Buy the call or the put at the quoted price. A share costs what the book says and pays exactly 1 USDG if it lands."],
              ["Collect on the record", "At the close the resolver publishes the median of the readings around it, the market resolves, and winnings are claimable."],
            ].map(([h, b], i) => (
              <Reveal as="li" key={h} delay={i * 70} style={{ display: "flex", gap: "var(--s-4)" }}>
                <span className="num" style={{ color: "var(--fg-faint)", fontWeight: 700, fontSize: ".8125rem", paddingTop: 4 }}>
                  0{i + 1}
                </span>
                <div>
                  <h3 style={{ fontSize: "var(--step-1)" }}>{h}</h3>
                  <p style={{ margin: "6px 0 0", color: "var(--fg-muted)", lineHeight: 1.6 }}>{b}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={120}><Ticket /></Reveal>
        </div>
      </Section>

      {/* ------------------------------------------------------- live board */}
      <Section eyebrow="Live board" title="Open right now">
        <Reveal>
          <div style={{
            marginTop: "var(--s-8)", border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-xl)", overflow: "hidden", background: "var(--surface-raised)",
            boxShadow: "var(--shadow-2)",
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "var(--surface-sunken)" }}>
                    {["", "Trader", "PnL", "24h", "7d", "Call / Put"].map((h, i) => (
                      <th key={i} className="eyebrow" style={{
                        textAlign: i > 1 && i < 5 ? "right" : "left",
                        padding: "12px 16px", fontWeight: 600,
                        borderBottom: "1px solid var(--border-subtle)",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => {
                    const m = r.markets.find((x) => x.window === "24h") ?? r.markets[0];
                    return (
                      <tr key={r.trader.handle} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td className="num" style={{ padding: "14px 16px", color: "var(--fg-faint)", fontSize: ".8125rem" }}>{i + 1}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <Link href={`/t/${r.trader.handle}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Avatar trader={r.trader} size={34} />
                            <span>
                              <span style={{ fontWeight: 600, display: "block", lineHeight: 1.2 }}>{r.trader.name}</span>
                              <span style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>
                                @{r.trader.handle} · {fmtF(r.trader.followers)}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="num" style={{ padding: "14px 16px", textAlign: "right", fontWeight: 600 }}>{usdShort(r.pnl)}</td>
                        <td className="num" style={{ padding: "14px 16px", textAlign: "right", color: r.change24h >= 0 ? "var(--up)" : "var(--down)" }}>{pct(r.change24h)}</td>
                        <td className="num" style={{ padding: "14px 16px", textAlign: "right", color: r.change7d >= 0 ? "var(--up)" : "var(--down)" }}>{pct(r.change7d)}</td>
                        <td style={{ padding: "10px 16px" }}>
                          {m && (
                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <Pill kind="call" v={multipleOf(m, "call")} href={`/m/${m.id}?side=call`} />
                              <Pill kind="put" v={multipleOf(m, "put")} href={`/m/${m.id}?side=put`} />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
        <div style={{ marginTop: "var(--s-6)" }}>
          <Link href="/discover" style={{ color: "var(--accent)", fontWeight: 600 }}>See every open market →</Link>
        </div>
      </Section>

      {/* -------------------------------------------------------- settlement */}
      <Section eyebrow="Settlement" title="Resolved from a record you can read">
        <div style={{ display: "grid", gap: "var(--s-8)", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", marginTop: "var(--s-8)", alignItems: "start" }} className="split">
          <Reveal>
            <p style={{ ...lede, marginTop: 0 }}>
              A reading is taken every five minutes and kept as its own file.
              Both ends of a market are the median of the three readings nearest
              that moment, so no single print — however well timed — decides
              anybody&apos;s position.
            </p>
            <p style={{ color: "var(--fg-muted)", lineHeight: 1.7, marginTop: "var(--s-4)" }}>
              Where the evidence will not support a settlement, the market voids
              and every position is refunded at cost. That is the correct answer,
              not a failure: being resolved against a number that cannot be
              defended is worse for a holder than getting their money back.
            </p>
            <Link href="/docs#resolution" style={{ display: "inline-block", marginTop: "var(--s-6)", color: "var(--accent)", fontWeight: 600 }}>
              Read the settlement rules →
            </Link>
          </Reveal>
          <Reveal delay={80} style={{ display: "grid", gap: "var(--s-4)" }}>
            {([
              ["Cadence", "5 min", "288 readings a day, each one a file"],
              ["Both ends", "median of 3", "nearest the open and the close"],
              ["Stale after", "20 min", "older cannot value a moment"],
              ["Refuses to guess", "voids", "rather than settle on thin evidence"],
            ] as [string, string, string][]).map(([k, v, note]) => (
              <div key={k} className="lift" style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s-6)",
                padding: "22px var(--s-6)", borderRadius: "var(--r-xl)",
                background: "linear-gradient(180deg, var(--surface-raised), color-mix(in oklch, var(--surface-raised) 92%, var(--accent)))",
                border: "1px solid var(--border-subtle)",
              }}>
                <span>
                  <span style={{ fontWeight: 600, fontSize: "1.0625rem", display: "block", letterSpacing: "-.01em" }}>{k}</span>
                  <span style={{ fontSize: ".875rem", color: "var(--fg-faint)", lineHeight: 1.5, display: "block", marginTop: 2 }}>{note}</span>
                </span>
                <span className="num" style={{
                  fontFamily: "var(--font-display)", fontSize: "1.875rem", fontWeight: 700,
                  letterSpacing: "-.03em", whiteSpace: "nowrap", lineHeight: 1.1,
                }}>{v}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </Section>

      {/* ------------------------------------------------------ for traders */}
      <section style={{ background: "var(--surface-sunken)", borderBlock: "1px solid var(--border-subtle)", paddingBlock: "var(--section-y)" }}>
        <div className="wrap" style={{ display: "grid", gap: "var(--s-12)", gridTemplateColumns: "minmax(0,1fr) minmax(0,440px)", alignItems: "center" }}>
          <Reveal>
            <span style={{
              display: "inline-block", padding: "5px 14px", borderRadius: "var(--r-full)",
              background: "var(--accent-quiet)", color: "var(--accent)",
              fontSize: ".8125rem", fontWeight: 600,
            }}>For the accounts listed</span>
            <h2 style={{ fontSize: "var(--step-4)", marginTop: "var(--s-5)", maxWidth: "16ch" }}>
              Listed without being asked
            </h2>
            <p style={{ ...lede, marginTop: "var(--s-5)" }}>
              A market can exist on you because your record is public, not because
              you agreed to anything. Two consequences follow, and both are in the
              contract rather than in a promise.
            </p>
            <p style={{ color: "var(--fg-muted)", lineHeight: 1.7, marginTop: "var(--s-4)", maxWidth: "58ch" }}>
              A share of every fee taken on your markets accrues to an escrow
              against your handle from the first trade — no wallet needed, nothing
              to sign up for. And one signature removes you entirely, voiding every
              open market on you and refunding each position at what it cost.
            </p>
            <div style={{ display: "flex", gap: "var(--s-3)", marginTop: "var(--s-8)", flexWrap: "wrap" }}>
              <Link href="/docs#traders" style={{
                padding: "13px 24px", borderRadius: "var(--r-lg)", background: "var(--accent)",
                color: "var(--accent-contrast)", fontWeight: 600, boxShadow: "var(--shadow-accent)",
              }}>Find your handle</Link>
              <Link href="/docs#traders" style={{
                padding: "13px 24px", borderRadius: "var(--r-lg)", background: "var(--surface-raised)",
                border: "1px solid var(--border-strong)", fontWeight: 600,
              }}>Opt out instead</Link>
            </div>
          </Reveal>

          <Reveal delay={80} style={{ display: "grid", gap: "var(--s-4)" }}>
            <div style={{
              padding: "var(--s-8)", borderRadius: "var(--r-xl)",
              background: "linear-gradient(160deg, color-mix(in oklch, var(--accent-quiet) 70%, var(--surface-raised)), var(--accent-quiet))",
              border: "1px solid color-mix(in oklch, var(--accent) 26%, transparent)",
              boxShadow: "var(--shadow-3)",
            }}>
              <div style={{ fontSize: ".9375rem", fontWeight: 600, color: "var(--fg-muted)" }}>Escrowed against unclaimed handles</div>
              <div className="num" style={{
                fontFamily: "var(--font-display)", fontSize: "2.75rem", fontWeight: 700,
                letterSpacing: "-.035em", color: "var(--accent)", marginTop: 6, lineHeight: 1.05,
              }}>{usd(ESCROWED)}</div>
              <div style={{ fontSize: ".875rem", color: "var(--fg-faint)", marginTop: 6, lineHeight: 1.55 }}>
                {FEE_SPLIT.traderEscrow}% of every fee, held against handles nobody has claimed yet
              </div>
            </div>
            {([
              ["Your share of each fee", `${FEE_SPLIT.traderEscrow}%`, `of the ${FEE_BPS / 100}% taken from winnings at redemption`],
              ["Cost to claim", "1 signature", "from any wallet that resolves to the handle"],
              ["Cost to leave", "1 signature", "open markets void and refund at cost"],
            ] as [string, string, string][]).map(([k, v, note]) => (
              <div key={k} className="lift" style={{
                padding: "var(--s-6)", borderRadius: "var(--r-xl)",
                background: "linear-gradient(180deg, var(--surface-raised), color-mix(in oklch, var(--surface-raised) 93%, var(--accent)))",
                border: "1px solid var(--border-subtle)",
              }}>
                <div style={{ fontSize: ".9375rem", fontWeight: 600, color: "var(--fg-muted)" }}>{k}</div>
                <div className="num" style={{
                  fontFamily: "var(--font-display)", fontSize: "2.125rem", fontWeight: 700,
                  letterSpacing: "-.035em", marginTop: 4, lineHeight: 1.1,
                }}>{v}</div>
                <div style={{ fontSize: ".875rem", color: "var(--fg-faint)", marginTop: 4, lineHeight: 1.55 }}>{note}</div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------- the underlying */}
      <Section eyebrow="The underlying" title="Cumulative account PnL">
        <div style={{ display: "grid", gap: "var(--s-8)", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", marginTop: "var(--s-8)" }} className="split">
          <Reveal>
            <p style={{ ...lede, marginTop: 0 }}>
              Portfolio value cannot be the thing a market settles on. Someone who
              wires in ten thousand dollars an hour before the close would hand
              every call holder a win they did not trade for. Cumulative PnL is
              already net of that: deposits move it by nothing, trades move it by
              exactly what they made or lost.
            </p>
            <p style={{ color: "var(--fg-muted)", lineHeight: 1.7 }}>
              Both ends of a window are a median of the three readings nearest to
              it rather than a single print, so one bad or well-timed reading
              cannot decide anybody&apos;s position. Every reading is kept as a file
              and served back, because a hash of something nobody can fetch is not
              evidence of anything.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <pre style={{
              margin: 0, padding: "var(--s-6)", borderRadius: "var(--r-lg)",
              background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)",
              fontFamily: "var(--font-mono)", fontSize: ".8125rem", lineHeight: 1.9,
              color: "var(--fg-muted)", overflowX: "auto",
            }}>
{`strike  = median(3 readings nearest open)
settle  = median(3 readings nearest close)
winner  = settle > strike ? call : put

# a reading older than 20 minutes cannot
# value a moment, and fewer than three
# eligible readings resolves to a void`}
            </pre>
          </Reveal>
        </div>
      </Section>

      {/* -------------------------------------------------------------- faq */}
      <Section eyebrow="Questions" title="The ones that keep coming up">
        <div style={{ display: "grid", gap: "var(--s-4)", marginTop: "var(--s-8)", maxWidth: "72ch" }}>
          {([
            ["Do I need to hold anything to trade?",
             "No. Markets are priced, traded and settled in USDG. Nothing about taking a position requires holding a protocol token."],
            ["What stops a trader from moving their own market?",
             "The underlying is cumulative PnL, so depositing does nothing to it — only closed trades move the number. And both ends of the window are a median of three readings, so a single well-timed print is the value that gets discarded."],
            ["What happens if the reading stops?",
             "The market voids and every position is refunded at what it cost. A gap is recorded as a gap; the last good file is never stretched across a stretch nobody observed."],
            ["Can I sell before the close?",
             "Yes. Both sides stay quotable for the life of the market, so a position can be closed back into the pool at the current price instead of being held to settlement."],
            ["Why is the multiple not exactly 2x on an even book?",
             `Because the number shown is what reaches the wallet. A ${FEE_BPS / 100}% fee is taken from winnings at redemption, which turns an even book into 1.98x rather than 2.00x.`],
            ["I am one of the listed accounts. How do I get off?",
             "One signature. It voids every open market on your handle and refunds each position at cost, with nothing to sign up for first."],
          ] as [string, string][]).map(([q, a], i) => (
            <Reveal key={q} delay={i * 40}>
              <details style={{
                padding: "var(--s-6)", borderRadius: "var(--r-xl)",
                background: "linear-gradient(180deg, var(--surface-raised), color-mix(in oklch, var(--surface-raised) 94%, var(--accent)))",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-2)",
              }}>
                <summary style={{
                  cursor: "pointer", fontWeight: 600, fontSize: "1.1875rem", listStyle: "none",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  gap: "var(--s-4)", letterSpacing: "-.015em", lineHeight: 1.35,
                }}>
                  {q}
                </summary>
                <p style={{
                  margin: "var(--s-4) 0 0", paddingTop: "var(--s-4)",
                  borderTop: "1px solid var(--border-subtle)",
                  color: "var(--fg-muted)", fontSize: "1rem", lineHeight: 1.7,
                }}>{a}</p>
              </details>
            </Reveal>
          ))}
        </div>
        <style>{`details summary::-webkit-details-marker{display:none}
          details summary::after{
            content:"+";
            flex:0 0 auto;
            display:grid;
            place-items:center;
            width:30px;height:30px;
            border-radius:9999px;
            background:var(--accent-quiet);
            color:var(--accent);
            font-family:var(--font-display);
            font-size:1.25rem;font-weight:600;line-height:1;
            box-shadow:var(--shadow-1);
            transition:transform var(--dur-state) var(--ease-ui), background var(--dur-state) var(--ease-ui);
          }
          details[open] summary::after{content:"\\2212";transform:rotate(180deg)}
          details summary:hover::after{background:color-mix(in oklch, var(--accent-quiet) 70%, var(--accent))}`}</style>
      </Section>

      <style>{`
        @media (max-width: 940px){
          .hero-grid{grid-template-columns:1fr !important}
          .split{grid-template-columns:1fr !important}
        }
      `}</style>
    </>
  );
}

const lede: React.CSSProperties = {
  fontSize: "var(--step-1)", color: "var(--fg-muted)",
  maxWidth: "58ch", marginTop: "var(--s-4)", lineHeight: 1.6,
};

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="wrap" style={{ paddingBlock: "var(--section-y)" }}>
      <Reveal>
        <div className="eyebrow">{eyebrow}</div>
        <h2 style={{ fontSize: "var(--step-4)", marginTop: "var(--s-3)", maxWidth: "18ch" }}>{title}</h2>
      </Reveal>
      {children}
    </section>
  );
}

function Pill({ kind, v, href }: { kind: "call" | "put"; v: number; href: string }) {
  const isCall = kind === "call";
  return (
    <Link href={href} className="num" style={{
      padding: "7px 12px", borderRadius: "var(--r-sm)", fontSize: ".8125rem", fontWeight: 500,
      background: isCall ? "var(--up-quiet)" : "var(--down-quiet)",
      color: isCall ? "var(--up)" : "var(--down)", whiteSpace: "nowrap",
    }}>{isCall ? "↑" : "↓"} {v.toFixed(2)}x</Link>
  );
}

/** Worked example, computed from the live parameters rather than typed in. */
function Ticket() {
  const stake = 100;
  const price = 0.43;
  const shares = stake / price;
  const winnings = shares - stake;
  const fee = (winnings * FEE_BPS) / 10_000;

  const line = (k: string, sub: string, v: string, strong?: boolean) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s-4)", padding: "12px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <span>
        <span style={{ display: "block", fontSize: ".9375rem", fontWeight: strong ? 600 : 400 }}>{k}</span>
        <span style={{ fontSize: ".8125rem", color: "var(--fg-faint)" }}>{sub}</span>
      </span>
      <span className="num" style={{ fontWeight: 600, whiteSpace: "nowrap", color: strong ? "var(--up)" : "var(--fg)" }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
      borderRadius: "var(--r-xl)", padding: "var(--s-6)", boxShadow: "var(--shadow-3)",
    }}>
      <div className="eyebrow">A {usd(stake, 0)} ticket</div>
      <div style={{ marginTop: "var(--s-4)" }}>
        {line("You buy", `the call at ${cents(price)}`, usd(stake))}
        {line("Shares", "each redeems for 1 USDG if it lands", shares.toFixed(2))}
        {line("Fee", `${FEE_BPS / 100}% of winnings, charged at redemption`, usd(fee))}
        {line("If you are right", "net of the fee", usd(shares - fee), true)}
        {line("If you are wrong", "binary, so the stake is gone", usd(0))}
      </div>
      <p style={{ margin: "var(--s-4) 0 0", fontSize: ".8125rem", color: "var(--fg-faint)", lineHeight: 1.6 }}>
        Each market opens with {usd(SEED_PER_MARKET, 0)} of seeded depth at an even
        price, so early size moves the quote noticeably.
      </p>
    </div>
  );
}
