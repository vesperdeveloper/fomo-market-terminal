"use client";
import { useEffect, useRef, useState } from "react";
import { short } from "@/lib/wallet";
import { explorerAddress } from "@/lib/chain";
import type { WalletState } from "./WalletButton";

/**
 * The connected account, and the two things anybody ever wants to do with it:
 * use a different one, or stop using this one.
 *
 * Styled from the tokens rather than from either build's own values, so the
 * same component reads as native in both — the terminal build's tighter radii
 * come out of its own `--r-md`, not out of a second copy of this file.
 */
export default function WalletMenu({ wallet }: { wallet: WalletState }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // a menu that will not close is worse than no menu
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!wallet.address) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* a browser that refuses the clipboard is not an error worth showing */ }
  };

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          padding: "5px 10px 5px 12px", borderRadius: "var(--r-md)",
          background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
          color: "var(--fg)", fontFamily: "inherit", lineHeight: 1.2,
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <span className="num" style={{ fontSize: ".875rem", fontWeight: 600 }}>
            {wallet.balance == null ? "—" : `$${wallet.balance.toFixed(2)}`}
          </span>
          <span className="num" style={{ fontSize: ".625rem", color: "var(--fg-faint)" }}>
            {short(wallet.address)}
          </span>
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 60,
            width: 264, padding: 6, borderRadius: "var(--r-md)",
            background: "var(--surface-raised)", border: "1px solid var(--border-strong)",
            boxShadow: "0 24px 60px -24px rgba(0,0,0,.95)",
          }}
        >
          <div style={{ padding: "10px 10px 12px" }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Connected</div>
            <button
              onClick={copy}
              title="Copy the full address"
              className="num"
              style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: "transparent", border: "none", padding: 0,
                color: "var(--fg)", fontSize: ".8125rem", wordBreak: "break-all",
                fontFamily: "inherit",
              }}
            >
              {copied ? "copied" : wallet.address}
            </button>
            <div className="num" style={{ marginTop: 8, fontSize: ".75rem", color: "var(--fg-faint)" }}>
              {wallet.balance == null ? "—" : `${wallet.balance.toFixed(2)} USDG`}
              {" · "}
              {wallet.gas == null ? "—" : `${wallet.gas.toFixed(5)} ETH`}
              {wallet.gas != null && wallet.gas <= 0 && (
                <span style={{ color: "var(--down)" }}> · no gas</span>
              )}
            </div>
          </div>

          <Item
            label="Switch wallet"
            hint="opens your wallet's account picker"
            busy={wallet.connecting}
            onClick={async () => { await wallet.switchWallet(); setOpen(false); }}
          />
          <Item
            label="Disconnect"
            hint="this site forgets the account"
            tone="down"
            onClick={async () => { await wallet.disconnect(); setOpen(false); }}
          />
          <a
            href={explorerAddress(wallet.address)}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block", padding: "9px 10px", borderRadius: "var(--r-sm)",
              fontSize: ".8125rem", color: "var(--fg-muted)",
            }}
          >
            View on the explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}

function Item({
  label, hint, onClick, tone, busy,
}: {
  label: string; hint: string; onClick: () => void; tone?: "down"; busy?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: busy ? "progress" : "pointer",
        padding: "9px 10px", borderRadius: "var(--r-sm)", border: "none",
        background: "transparent", fontFamily: "inherit",
        color: tone === "down" ? "var(--down)" : "var(--fg)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover, rgba(255,255,255,.06))")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ display: "block", fontSize: ".875rem", fontWeight: 500 }}>{label}</span>
      <span style={{ display: "block", fontSize: ".75rem", color: "var(--fg-faint)", marginTop: 1 }}>{hint}</span>
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--fg-faint)"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
