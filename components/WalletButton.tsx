"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import {
  connect, usdgBalance, gasBalance, hasWallet, short, injected,
  switchAccount, forgetWallet,
} from "@/lib/wallet";

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
  /** native ETH on the chain, which is what pays for gas */
  gas: number | null;
  installed: boolean;
  connecting: boolean;
  error: string | null;
  connectWallet: () => Promise<Address | null>;
  /** Ask the wallet to offer its account picker. */
  switchWallet: () => Promise<Address | null>;
  /** Drop the account on this site, and stop resuming it on later visits. */
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* One wallet, shared, and asked for only when it is needed            */
/* ------------------------------------------------------------------ */

/**
 * Nothing here touches the wallet until somebody asks it to.
 *
 * This used to run on mount, in the nav, on every page: arriving at the site
 * to read the board meant an extension lighting up before you had done
 * anything. Reading a board needs no wallet, and a venue that demands one at
 * the door is asking for a signature in exchange for nothing.
 *
 * It also used to pick a previous session back up with eth_accounts, which
 * prompts nothing — but it is still a request to the wallet on page load, and
 * with more than one extension installed that is enough to make one of them
 * speak up. Browsing asks the wallet nothing at all now; connecting happens
 * where it belongs, at the stake.
 *
 * So the state lives in one module-level store rather than in each component.
 * The ticket asks for a wallet at the moment of the stake; the store then
 * tells the nav, which is why the balance appears up there without the nav
 * ever having asked.
 */
interface Snapshot {
  address: Address | null;
  balance: number | null;
  gas: number | null;
  installed: boolean;
  connecting: boolean;
  error: string | null;
}

let snapshot: Snapshot = {
  address: null, balance: null, gas: null, installed: false, connecting: false, error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const getSnapshot = () => snapshot;

/** Track account switches — attached only once a wallet is actually in play. */
let watching = false;
function watchAccounts() {
  if (watching) return;
  const eth = injected();
  if (!eth?.on) return;
  watching = true;
  eth.on("accountsChanged", (...args: unknown[]) => {
    const accounts = args[0] as string[] | undefined;
    set({ address: accounts?.length ? (accounts[0] as Address) : null, balance: null, gas: null });
    if (accounts?.length) void loadBalance(accounts[0] as Address);
  });
}

async function loadBalance(address: Address) {
  const [usdg, eth] = await Promise.allSettled([usdgBalance(address), gasBalance(address)]);
  set({
    balance: usdg.status === "fulfilled" ? usdg.value : null,
    gas: eth.status === "fulfilled" ? eth.value : null,
  });
}

/** The one call that can open a wallet. Nothing else in the app may. */
async function connectWallet(): Promise<Address | null> {
  set({ connecting: true, error: null });
  try {
    const a = await connect();
    set({ address: a, installed: true, connecting: false });
    watchAccounts();
    void loadBalance(a);
    return a;
  } catch (e) {
    set({
      connecting: false,
      installed: hasWallet(),
      error: e instanceof Error ? e.message : "could not connect",
    });
    return null;
  }
}

async function switchWallet(): Promise<Address | null> {
  set({ connecting: true, error: null });
  try {
    const a = await switchAccount();
    set({ address: a, balance: null, gas: null, installed: true, connecting: false });
    watchAccounts();
    void loadBalance(a);
    return a;
  } catch (e) {
    const code = (e as { code?: number })?.code;
    set({
      connecting: false,
      error: code === 4001 ? null : e instanceof Error ? e.message : "could not switch",
    });
    return null;
  }
}

async function disconnect(): Promise<void> {
  await forgetWallet();
  set({ address: null, balance: null, gas: null, error: null });
}

/** The connected account and its USDG balance, if there is one yet. */
export function useWallet(): WalletState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refreshBalance = useCallback(async () => {
    if (!snapshot.address) { set({ balance: null, gas: null }); return; }
    await loadBalance(snapshot.address);
  }, []);

  return { ...state, connectWallet, switchWallet, disconnect, refreshBalance };
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
