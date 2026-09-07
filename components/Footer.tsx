import Link from "next/link";
import Mark from "./Mark";

const COLS: [string, [string, string][]][] = [
  ["Market", [["/discover", "Board"], ["/leaderboard", "Ranks"], ["/portfolio", "Positions"]]],
  ["Protocol", [["/docs#contract", "The contract"], ["/docs#resolution", "Snapshots"], ["/docs#void", "Voids"], ["/docs#params", "Parameters"]]],
  ["Accounts", [["/docs#traders", "Claim a handle"], ["/docs#traders", "Opt out"]]],
];

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--rule)",
        background: "var(--surface-sunken)",
        marginTop: "var(--section-y)",
      }}
    >
      <div
        className="wrap-wide"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 1.5fr) repeat(3, minmax(120px, 1fr))",
          borderInline: "1px solid var(--rule)",
        }}
      >
        <div style={{ padding: "var(--s-10) var(--s-6) var(--s-10) 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--fg)", display: "flex" }}><Mark size={18} /></span>
            <span className="wordmark" style={{ fontSize: "1.0625rem" }}>fomo market</span>
          </div>
          <p style={{ margin: "var(--s-4) 0 0", fontSize: ".875rem", color: "var(--fg-muted)", maxWidth: 330, lineHeight: 1.7 }}>
            The traders are the instrument. Up or down on a fomo account&apos;s PnL,
            staked and settled in one contract anyone can read back.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", marginTop: "var(--s-5)" }}>
            <a
              href="https://x.com/usefomo_market"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="fomo market on X"
              style={{
                display: "grid", placeItems: "center", width: 32, height: 32,
                borderRadius: "var(--r-sm)", border: "1px solid var(--rule)",
                background: "var(--surface-raised)", color: "var(--fg-muted)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.66l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.11z" />
              </svg>
            </a>
            <span
              className="num"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 12px", borderRadius: "var(--r-sm)",
                border: "1px solid var(--rule)", background: "var(--surface-raised)",
                fontSize: ".75rem", color: "var(--fg-muted)",
              }}
            >
              <span style={{ color: "var(--fg-faint)" }}>CA:</span>
              <span style={{ color: "var(--accent-hover)" }}>soon</span>
            </span>
          </div>
        </div>

        {COLS.map(([title, links]) => (
          <div key={title} style={{ padding: "var(--s-10) var(--s-5)", borderLeft: "1px solid var(--rule)" }}>
            <div className="eyebrow" style={{ marginBottom: "var(--s-4)" }}>{title}</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--s-2)" }}>
              {links.map(([href, label]) => (
                <li key={label}>
                  <Link href={href} style={{ fontSize: ".875rem", color: "var(--fg-muted)" }}>{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div
        className="wrap-wide"
        style={{
          paddingBlock: "var(--s-5)",
          borderTop: "1px solid var(--rule)",
          display: "flex", flexWrap: "wrap", gap: "var(--s-4)",
          justifyContent: "space-between", fontSize: ".75rem", color: "var(--fg-faint)",
        }}
      >
        <span>Positions carry risk of total loss. Nothing here is investment advice.</span>
        <span>An independent market. Not affiliated with, or endorsed by, fomo.</span>
      </div>
    </footer>
  );
}
