"use client";
import {
  createWalletClient, createPublicClient, custom, http,
  erc20Abi, getAddress, parseUnits,
  type Address, type Hash,
} from "viem";
import { robinhood, USDG, USDG_DECIMALS } from "./chain";

type Eip1193 = {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(e: string, cb: (...a: unknown[]) => void): void;
  removeListener?(e: string, cb: (...a: unknown[]) => void): void;
};

export function injected(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

export const hasWallet = () => Boolean(injected());

const CHAIN_HEX = `0x${robinhood.id.toString(16)}`;

/** Connect, and make sure the wallet is actually on Robinhood Chain. */
export async function connect(): Promise<Address> {
  const eth = injected();
  if (!eth) throw new Error("no wallet found in this browser");

  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("no account was authorised");

  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() !== CHAIN_HEX) {
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (e) {
      // 4902: the wallet does not know this chain yet, so offer to add it
      const code = (e as { code?: number })?.code;
      if (code !== 4902) throw e;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_HEX,
          chainName: robinhood.name,
          nativeCurrency: robinhood.nativeCurrency,
          rpcUrls: [robinhood.rpcUrls.default.http[0]],
          blockExplorerUrls: [robinhood.blockExplorers.default.url],
        }],
      });
    }
  }
  return getAddress(accounts[0]);
}

export async function currentAccount(): Promise<Address | null> {
  const eth = injected();
  if (!eth) return null;
  try {
    const a = (await eth.request({ method: "eth_accounts" })) as string[];
    return a?.length ? getAddress(a[0]) : null;
  } catch { return null; }
}

const reader = () => createPublicClient({ chain: robinhood, transport: http() });

/** The wallet's USDG balance, so a ticket it cannot afford says so first. */
export async function usdgBalance(owner: Address): Promise<number> {
  const bal = await reader().readContract({
    address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [owner],
  });
  return Number(bal) / 10 ** USDG_DECIMALS;
}

/**
 * Send `usd` USDG to the treasury and wait for it to be mined.
 *
 * The server re-reads this receipt before it hands out any shares, so the
 * wait is not decoration: submitting a hash that has not landed yet would
 * simply be refused.
 */
export async function payUSDG(to: string, usd: number): Promise<Hash> {
  const eth = injected();
  if (!eth) throw new Error("no wallet found in this browser");
  const account = await connect();

  const wallet = createWalletClient({
    account, chain: robinhood, transport: custom(eth),
  });

  const hash = await wallet.writeContract({
    address: USDG, abi: erc20Abi, functionName: "transfer",
    args: [getAddress(to), parseUnits(usd.toFixed(USDG_DECIMALS), USDG_DECIMALS)],
    chain: robinhood, account,
  });

  const receipt = await reader().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("the payment reverted on chain");
  return hash;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
