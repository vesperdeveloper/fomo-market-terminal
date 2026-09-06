"use client";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { connect, currentAccount, usdgBalance, hasWallet, short, injected } from "@/lib/wallet";

/* ------------------------------------------------------------------ */
/* Venue                                                               */
/* ------------------------------------------------------------------ */

export type Venue =
  | {
      live: true; testnet: boolean; chainId: number; chainName: string;
      contract: string; explorer: string; collateral: string;
      oracle: string | null; oracleGas: number; publishing: boolean;
      markets: { total: number; open: number };
      staked: number; held: number; feeAccrued: number;
    }
  | { live: false; chainId?: number; reason?: string };

/**
 * Which contract this deployment trades against, and whether its oracle is
 * still able to publish. Everything downstream branches on this one answer
 * rather than guessing from whether a wallet happens to be installed.
 */
export function useVenue() {
  const [venue, setVenue] = useState<Venue | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/venue")
      .then((r) => r.json())
      .then((v) => { if (alive) setVenue(v as Venue); })
      .catch(() => { if (alive) setVenue({ live: false, reason: "venue unreachable" }); });
    return () => { alive = false; };
  }, []);
  return venue;
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
