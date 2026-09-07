"use client";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { connect, currentAccount, usdgBalance, hasWallet, short, injected } from "@/lib/wallet";

/* ------------------------------------------------------------------ */
/* Treasury                                                            */
/* ------------------------------------------------------------------ */

export type Treasury =
  | { live: true; address: string; collateral: number; liability: number; headroom: number; covered: number }
  | { live: false; reason?: string };

/**
 * Whether this deployment takes real money, and where it takes it.
 *
 * A deployment without a treasury still trades - it simply books positions
 * without a payment, which is what local and preview builds do. Everything
 * downstream branches on this one answer rather than guessing from whether
 * a wallet happens to be installed.
 */
export function useTreasury() {
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/treasury")
      .then((r) => r.json())
      .then((t) => { if (alive) setTreasury(t as Treasury); })
      .catch(() => { if (alive) setTreasury({ live: false, reason: "treasury unreachable" }); });
    return () => { alive = false; };
  }, []);
  return treasury;
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

export interface WalletState {
  address: Address | null;
  balance: number | null;
  installed: boolean;
  connecting: boolean;
  error: string | null;
  connectWallet: () => Promise<Address | null>;
  refreshBalance: () => Promise<void>;
}

/** The connected account, its USDG balance, and a way to get both. */
export function useWallet(): WalletState {
  const [address, setAddress] = useState<Address | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [installed, setInstalled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pick up an already-authorised account without prompting
  useEffect(() => {
    let alive = true;
    setInstalled(hasWallet());
    currentAccount().then((a) => { if (alive) setAddress(a); }).catch(() => {});

    const eth = injected();
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAddress(accounts?.length ? (accounts[0] as Address) : null);
      setBalance(null);
    };
    eth?.on?.("accountsChanged", onAccounts);
    return () => { alive = false; eth?.removeListener?.("accountsChanged", onAccounts); };
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address) { setBalance(null); return; }
    try { setBalance(await usdgBalance(address)); } catch { setBalance(null); }
  }, [address]);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  const connectWallet = useCallback(async () => {
    setConnecting(true); setError(null);
    try {
      const a = await connect();
      setAddress(a);
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not connect");
      return null;
    } finally { setConnecting(false); }
  }, []);

  return { address, balance, installed, connecting, error, connectWallet, refreshBalance };
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

/** Small pill that either connects a wallet or shows the connected one. */
export function WalletButton({ wallet }: { wallet: WalletState }) {
  const { address, balance, installed, connecting, connectWallet } = wallet;

  if (address) {
    return (
      <span
        className="num"
        title={address}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 12px", borderRadius: "var(--r-full)",
          background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
          fontSize: ".8125rem", fontWeight: 600, color: "var(--fg-muted)",
        }}
      >
        <i style={{ width: 6, height: 6, borderRadius: 9, background: "var(--up)" }} />
        {short(address)}
        {balance != null && (
          <span style={{ color: "var(--fg-faint)" }}>· {balance.toFixed(2)} USDG</span>
        )}
      </span>
    );
  }

  if (!installed) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-flex", alignItems: "center",
          padding: "6px 12px", borderRadius: "var(--r-full)",
          background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
          fontSize: ".8125rem", fontWeight: 600, color: "var(--accent)",
        }}
      >
        Install a wallet
      </a>
    );
  }

  return (
    <button
      onClick={() => { void connectWallet(); }}
      disabled={connecting}
      style={{
        padding: "6px 14px", borderRadius: "var(--r-full)", border: "none",
        background: "var(--accent)", color: "var(--accent-contrast)",
        fontSize: ".8125rem", fontWeight: 600, fontFamily: "inherit",
        cursor: connecting ? "progress" : "pointer",
      }}
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export default WalletButton;
