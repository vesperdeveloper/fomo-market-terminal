"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Mark from "./Mark";
import { useWallet } from "./WalletButton";
import WalletMenu from "./WalletMenu";
import { short } from "@/lib/wallet";

const LINKS = [
  ["/discover", "Board"],
  ["/leaderboard", "Ranks"],
  ["/portfolio", "Positions"],
  ["/docs", "Docs"],
];

/** UTC, ticking. The record is kept in UTC and every market closes on it,
 *  so the clock in the corner is the one the site actually runs on. */
function Clock() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setT(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="num" style={{ fontSize: ".75rem", color: "var(--fg-faint)" }}>
      {t ?? "--:--:--"} UTC
    </span>
  );
}

export default function Nav() {
  const path = usePathname();
  const wallet = useWallet();

  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 50, height: "var(--nav-h)",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div className="wrap-wide" style={{ height: "100%", display: "flex", alignItems: "center", gap: "var(--s-5)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ color: "var(--fg)", display: "flex" }}><Mark size={20} /></span>
          <span className="wordmark" style={{ fontSize: "1.125rem" }}>fomo market</span>
        </Link>

        <a
          href="https://x.com/usefomo_market"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="fomo market on X"
          style={{
            display: "grid", placeItems: "center", width: 28, height: 28,
            borderRadius: "var(--r-sm)", color: "var(--fg-faint)", flexShrink: 0,
            transition: "color var(--dur-micro) var(--ease-ui)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-faint)")}
        >
          <XIcon />
        </a>

        <span className="nav-rule" style={{ width: 1, height: 20, background: "var(--rule)" }} />

        {/* tabs are mono and tracked out — labels on a board, not menu items */}
        <nav className="nav-links" style={{ display: "flex", gap: "var(--s-5)", alignItems: "center", height: "100%" }}>
          {LINKS.map(([href, label]) => {
            const active = path === href || path.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className="num"
                style={{
                  position: "relative", height: "100%", display: "flex", alignItems: "center",
                  fontSize: ".75rem", letterSpacing: ".16em", textTransform: "uppercase",
                  color: active ? "var(--fg)" : "var(--fg-faint)",
                  transition: "color var(--dur-micro) var(--ease-ui)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = active ? "var(--fg)" : "var(--fg-faint)")}
              >
                {label}
                {active && (
                  <i style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 1, background: "var(--accent)" }} />
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--s-4)" }}>
          <span className="nav-clock"><Clock /></span>

          {/* the contract address, once there is one to publish */}
          <span
            className="nav-ca num"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 10px", borderRadius: "var(--r-sm)",
              border: "1px solid var(--rule)", background: "var(--surface-raised)",
              fontSize: ".75rem", color: "var(--fg-muted)", whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "var(--fg-faint)" }}>CA</span>
            <span style={{ color: "var(--fg-faint)" }}>:</span>
            <span style={{ color: "var(--accent-hover)" }}>soon</span>
          </span>

          {/* The balance only appears once there is a wallet in play, and it
              is a menu rather than a label: switching accounts and dropping
              one are the only two things anybody wants from it. */}
          <WalletMenu wallet={wallet} />

          <Link
            href="/discover"
            className="num"
            style={{
              padding: "8px 16px", borderRadius: "var(--r-sm)", background: "var(--accent)",
              color: "var(--accent-contrast)", fontSize: ".75rem",
              letterSpacing: ".1em", textTransform: "uppercase", whiteSpace: "nowrap",
              transition: "background var(--dur-micro) var(--ease-ui)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
          >
            Open board
          </Link>
        </div>
      </div>
      <style>{`
        @media (max-width: 1100px){ .nav-links{display:none !important} .nav-rule{display:none !important} }
        @media (max-width: 900px){ .nav-clock{display:none !important} }
        @media (max-width: 700px){ .nav-ca{display:none !important} }
      `}</style>
    </header>
  );
}

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.66l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.11z" />
    </svg>
  );
}
