import Link from "next/link";
import { notFound } from "next/navigation";
import { board, multipleOf, priceOf } from "@/lib/view";
import { Avatar, Verified } from "@/components/TraderCard";
import TraderChartPanel from "@/components/TraderChartPanel";
import Reveal from "@/components/Reveal";
import Banner from "@/components/Banner";
import { usd, usdShort, pct, cents, signed, followers as fmtF } from "@/lib/format";
import { fullSize } from "@/lib/img";

export const dynamic = "force-dynamic";

export default async function TraderPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const { rows } = await board();
  const row = rows.find((r) => r.trader.handle.toLowerCase() === handle.toLowerCase());
  if (!row) notFound();

  return (
    <div style={{ paddingBottom: "var(--section-y)" }}>
      {/* Banner — sits below nav, no negative margin */}
      <div style={{
        position: "relative", width: "100%", height: 224,
        overflow: "hidden",
      }}>
        {row.trader.banner
          ? <div style={{ height: "100%", width: "100%", background: `center/cover url(${row.trader.banner})` }} />
          : <Banner handle={row.trader.handle} height={224}
              avatar={row.trader.avatar ? fullSize(row.trader.avatar) : undefined} />}
      </div>

      <div className="wrap">
        {/* Avatar + View on fomo row — avatar overlaps banner bottom */}
        <div style={{
          marginTop: -44, display: "flex", alignItems: "flex-end",
          justifyContent: "space-between", gap: "var(--s-4)",
          position: "relative", zIndex: 1,
        }}>
          <span style={{
            position: "relative", display: "inline-block", flexShrink: 0,
            overflow: "hidden", borderRadius: "var(--r-full)",
            boxShadow: "0 0 0 4px var(--surface)",
            width: 88, height: 88,
          }}>
            {row.trader.avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={fullSize(row.trader.avatar)} alt="" width={88} height={88}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{
                  width: "100%", height: "100%", display: "grid", placeItems: "center",
                  background: "var(--accent-quiet)", color: "var(--accent)",
                  fontWeight: 700, fontSize: 30, fontFamily: "var(--font-display)",
                }}>
                  {(row.trader.name || row.trader.handle).slice(0, 2).toUpperCase()}
                </div>}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4 }}>
            <a href={`https://fomo.family/profile/${row.trader.handle}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", height: 44,
                padding: "0 16px", borderRadius: "var(--r-md)",
                border: "1px solid var(--border-subtle)",
                fontSize: "13px", fontWeight: 600, color: "var(--fg)",
                transition: "border-color var(--dur-state)",
              }}>View on fomo</a>
          </div>
        </div>

        {/* Name */}
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <h1 style={{
            fontSize: 26, fontWeight: 600, lineHeight: 1.15,
            letterSpacing: "-.02em", color: "var(--fg)",
          }}>{row.trader.name}</h1>
          <Verified />
        </div>

        {/* Handle */}
        <div style={{ fontSize: 14, color: "var(--fg-muted)", marginTop: 2 }}>
          @{row.trader.handle}
        </div>

        {/* Bio */}
        {row.trader.bio && (
          <p style={{
            marginTop: 16, maxWidth: "42rem", fontSize: 15,
            color: "var(--fg-muted)", lineHeight: 1.6,
          }}>{row.trader.bio}</p>
        )}

        {/* Stats bar */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" style={{
          marginTop: 24,
          gap: "20px 24px",
          borderBlock: "1px solid var(--border-subtle)",
          paddingBlock: 20,
        }}>
          <Stat k="Total PnL" v={usdShort(row.pnl)} />
          <Stat k="24H" v={signed(row.delta24h)} tone={row.delta24h >= 0 ? "up" : "down"} />
          <Stat k="7D" v={signed(row.delta7d)} tone={row.delta7d >= 0 ? "up" : "down"} />
          <Stat k="30D" v={signed(row.delta30d)} tone={row.delta30d >= 0 ? "up" : "down"} />
          <Stat k="Followers" v={fmtF(row.trader.followers)} />
          <Stat k="Vol (σ)" v={usdShort(row.stats.vol)} />
        </dl>

        {/* Chart panel */}
        <Reveal>
          <div style={{
            marginTop: 32, padding: "20px 24px",
            borderRadius: "var(--r-xl)", border: "1px solid var(--border-subtle)",
            background: "var(--surface-raised)",
          }}>
            <TraderChartPanel history={row.history} pnl={row.pnl} />
          </div>
        </Reveal>

        {/* Open markets */}
        <div style={{ marginTop: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Take a side</div>
          <h2 style={{ fontSize: "var(--step-2)" }}>Open markets</h2>
          <div style={{
            display: "grid", gap: "var(--s-4)", marginTop: "var(--s-6)",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}>
            {row.markets.length === 0 && (
              <p style={{ color: "var(--fg-muted)" }}>Nothing open on this handle right now.</p>
            )}
            {row.markets.map((m, i) => (
              <Reveal key={m.id} delay={i * 60}>
                <div className="lift" style={{
                  padding: "var(--s-6)", borderRadius: "var(--r-xl)",
                  background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
                  transition: "transform var(--dur-hover) var(--ease-lift), border-color var(--dur-hover) var(--ease-lift), box-shadow var(--dur-hover) var(--ease-lift)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{
                      fontWeight: 600, fontSize: "1.1875rem",
                      fontFamily: "var(--font-display)", letterSpacing: "-.02em",
                      lineHeight: 1.3,
                    }}>
                      Will @{row.trader.handle} be up over the next {m.window === "24h" ? "24 hours" : "7 days"}?
                    </span>
                  </div>
                  <div className="num" style={{
                    marginTop: 10, fontSize: ".875rem", color: "var(--fg-faint)",
                    display: "flex", justifyContent: "space-between", gap: 12,
                  }}>
                    <span>#{m.id}</span>
                    <span>struck at {m.strike != null ? usdShort(m.strike) : "—"}</span>
                  </div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr",
                    gap: "var(--s-2)", marginTop: "var(--s-4)",
                  }}>
                    <SideLink id={m.id} side="call" price={priceOf(m, "call")} mult={multipleOf(m, "call")} />
                    <SideLink id={m.id} side="put" price={priceOf(m, "put")} mult={multipleOf(m, "put")} />
                  </div>
                  <div className="num" style={{
                    marginTop: "var(--s-3)", paddingTop: "var(--s-3)",
                    borderTop: "1px solid var(--border-subtle)",
                    fontSize: ".8125rem", color: "var(--fg-faint)",
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span>Closes {new Date(m.closesAt).toISOString().replace("T", " ").slice(0, 16)}Z</span>
                    <span>{usdShort(m.volume)} vol</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div>
      <dt className="eyebrow">{k}</dt>
      <dd className="num" style={{
        margin: "2px 0 0", fontSize: 17, fontWeight: 600,
        color: tone ? `var(--${tone})` : "var(--fg)",
      }}>{v}</dd>
    </div>
  );
}

function SideLink({ id, side, price, mult }: { id: number; side: "call" | "put"; price: number; mult: number }) {
  const isCall = side === "call";
  const tone = isCall ? "up" : "down";
  return (
    <Link href={`/m/${id}?side=${side}`} style={{
      display: "block", padding: "18px 16px", borderRadius: "var(--r-lg)",
      textAlign: "center",
      background: `linear-gradient(180deg, var(--${tone}-quiet), color-mix(in oklch, var(--${tone}-quiet) 82%, var(--${tone})))`,
      border: `1px solid color-mix(in oklch, var(--${tone}) 26%, transparent)`,
      color: `var(--${tone})`,
      boxShadow: "var(--shadow-2)",
      transition: "transform var(--dur-hover) var(--ease-lift), box-shadow var(--dur-hover) var(--ease-lift)",
    }} className="lift">
      <div style={{
        fontWeight: 700, fontSize: "1.125rem",
        fontFamily: "var(--font-display)", letterSpacing: "-.02em",
      }}>{isCall ? "↑ Call" : "↓ Put"}</div>
      <div className="num" style={{
        fontSize: "1.0625rem", fontWeight: 600, marginTop: 4, opacity: .9,
      }}>
        {cents(price)} · {mult.toFixed(2)}x
      </div>
    </Link>
  );
}
