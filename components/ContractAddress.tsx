"use client";
import { useState } from "react";
import { TOKEN, shortCA } from "@/lib/token";
import { explorerAddress } from "@/lib/chain";

/**
 * The contract address, in the one form anybody actually wants it: copyable.
 *
 * Shown in full where there is room, because a CA is something people verify
 * character by character against the post that sent them, and abbreviated
 * only where a full one would break the layout. Either way the click copies
 * the whole thing and says so — a silent copy leaves you pressing twice.
 */
export default function ContractAddress({
  full = false,
  size = ".8125rem",
}: {
  full?: boolean;
  size?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // a browser that refuses the clipboard still shows the address itself
    }
  };

  return (
    <span
      className="num"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: full ? "10px 16px" : "6px 12px",
        borderRadius: "var(--r-md)",
        background: "var(--surface-raised)",
        border: "1px solid var(--border-subtle)",
        fontSize: size, color: "var(--fg-muted)", whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      <span style={{ color: "var(--fg-faint)", flexShrink: 0 }}>CA:</span>
      <button
        onClick={copy}
        title={`${TOKEN.address} — click to copy`}
        className="num"
        style={{
          background: "transparent", border: "none", padding: 0, cursor: "pointer",
          color: copied ? "var(--up)" : "var(--fg)", fontFamily: "inherit",
          fontSize: "inherit", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {copied ? "copied" : full ? TOKEN.address : shortCA()}
      </button>
      <a
        href={explorerAddress(TOKEN.address)}
        target="_blank"
        rel="noreferrer"
        aria-label="View the contract on the explorer"
        title="View on the explorer"
        style={{ color: "var(--fg-faint)", display: "flex", flexShrink: 0 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 17L17 7M17 7H9M17 7v8" />
        </svg>
      </a>
    </span>
  );
}
