"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { connect, currentAccount, usdgBalance, gasBalance, hasWallet, short, injected } from "@/lib/wallet";

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

const REMEMBER_KEY = "fomomarket.wallet.seen";

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

/**
 * Pick a previous session back up without prompting.
 *
 * `eth_accounts` never opens a wallet — it only reports what has already been
 * authorised — but it is still gated on having connected here before, so a
 * first-time visitor's extension is not touched at all.
 */
let resumed = false;
async function resumeQuietly() {
  if (resumed || typeof window === "undefined") return;
  resumed = true;
  let seen = false;
  try { seen = localStorage.getItem(REMEMBER_KEY) === "1"; } catch {}
  if (!seen) return;
  const a = await currentAccount().catch(() => null);
  if (!a) return;
  set({ address: a, installed: true });
  watchAccounts();
  void loadBalance(a);
}

/** The one call that can open a wallet. Nothing else in the app may. */
async function connectWallet(): Promise<Address | null> {
  set({ connecting: true, error: null });
  try {
    const a = await connect();
    try { localStorage.setItem(REMEMBER_KEY, "1"); } catch {}
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

/** The connected account and its USDG balance, if there is one yet. */
export function useWallet(): WalletState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => { void resumeQuietly(); }, []);

  const refreshBalance = useCallback(async () => {
    if (!snapshot.address) { set({ balance: null, gas: null }); return; }
    await loadBalance(snapshot.address);
  }, []);

  return { ...state, connectWallet, refreshBalance };
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
