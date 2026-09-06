import { chainReady, chain, isTestnet } from "@/lib/chain";

/**
 * The state between "the site is up" and "the book is open".
 *
 * A board with no markets on it looks broken unless it says why, so this is
 * shown wherever markets would be. It is deliberately specific: what is
 * missing, what happens when it arrives, and what is already running.
 */
export default function VenueBanner() {
  if (chainReady()) return null;

  return (
    <div
      style={{
        marginTop: "var(--s-6)",
        padding: "var(--s-5)",
        borderRadius: "var(--r-lg)",
        background: "var(--accent-quiet)",
        border: "1px solid rgba(96,106,247,.28)",
        display: "flex",
        gap: "var(--s-4)",
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          padding: "4px 10px", borderRadius: "var(--r-sm)", fontSize: ".6875rem",
          letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600,
          background: "var(--accent)", color: "var(--accent-contrast)", whiteSpace: "nowrap",
        }}
      >
        Pre-launch
      </span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 500, fontSize: "1.0625rem", letterSpacing: "-.02em" }}>
          The record is live. The book opens when the contract does.
        </div>
        <p style={{ margin: "6px 0 0", color: "var(--fg-muted)", fontSize: ".9375rem", lineHeight: 1.6, maxWidth: "72ch" }}>
          Readings are being taken and published every five minutes, which is what
          every market settles on — that part is already running. Staking is not:
          it needs the market contract deployed on {chain.name}
          {isTestnet ? "" : " and its oracle funded for gas"}, and until that
          address exists there is nothing here that could take your money, which
          is the correct way round.
        </p>
      </div>
    </div>
  );
}
