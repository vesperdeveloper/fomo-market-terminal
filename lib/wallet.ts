"use client";
import {
  createWalletClient, createPublicClient, custom, http,
  erc20Abi, getAddress, parseUnits,
  type Address, type Hash,
} from "viem";
import { chain, USDG, USDG_DECIMALS, marketAddress } from "./chain";
import { artifacts } from "./artifacts";
import { SIDE_INDEX } from "./onchain";
import type { Side } from "./types";

const marketAbi = artifacts.FomoMarket.abi;

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

const CHAIN_HEX = `0x${chain.id.toString(16)}`;

/** Connect, and make sure the wallet is actually on the right chain. */
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
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrls.default.http[0]],
          blockExplorerUrls: [chain.blockExplorers!.default.url],
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

const reader = () => createPublicClient({ chain, transport: http() });

const units = (usd: number) => parseUnits(usd.toFixed(USDG_DECIMALS), USDG_DECIMALS);

/** The wallet's USDG balance, so a ticket it cannot afford says so first. */
export async function usdgBalance(owner: Address): Promise<number> {
  const bal = await reader().readContract({
    address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [owner],
  });
  return Number(bal) / 10 ** USDG_DECIMALS;
}

/** What the contract is currently allowed to pull. */
export async function usdgAllowance(owner: Address): Promise<number> {
  const market = marketAddress();
  if (!market) return 0;
  const a = await reader().readContract({
    address: USDG, abi: erc20Abi, functionName: "allowance", args: [owner, market],
  });
  return Number(a) / 10 ** USDG_DECIMALS;
}

async function walletClient() {
  const eth = injected();
  if (!eth) throw new Error("no wallet found in this browser");
  const account = await connect();
  return { account, wallet: createWalletClient({ account, chain, transport: custom(eth) }) };
}

/**
 * Let the contract pull `usd` from this wallet.
 *
 * Approving exactly the ticket rather than an unlimited allowance: the extra
 * signature is cheap, and an allowance that outlives the trade is a standing
 * permission nobody asked for.
 */
export async function approveUSDG(usd: number): Promise<Hash> {
  const market = marketAddress();
  if (!market) throw new Error("no market contract configured");
  const { account, wallet } = await walletClient();

  const hash = await wallet.writeContract({
    address: USDG, abi: erc20Abi, functionName: "approve",
    args: [market, units(usd)],
    chain, account,
  });
  const receipt = await reader().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("the approval reverted on chain");
  return hash;
}

/**
 * Take a side. The stake moves into the contract in this transaction — there
 * is no moment where the site is holding the money, because the site never
 * holds it.
 */
export async function stakeOnChain(marketId: number, side: Side, usd: number): Promise<Hash> {
  const market = marketAddress();
  if (!market) throw new Error("no market contract configured");
  const { account, wallet } = await walletClient();

  const hash = await wallet.writeContract({
    address: market, abi: marketAbi, functionName: "stake",
    args: [BigInt(marketId), SIDE_INDEX[side], units(usd)],
    chain, account,
  });
  const receipt = await reader().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("the ticket reverted on chain");
  return hash;
}

/** Collect a settled position or a refund. */
export async function claimOnChain(marketId: number): Promise<Hash> {
  const market = marketAddress();
  if (!market) throw new Error("no market contract configured");
  const { account, wallet } = await walletClient();

  const hash = await wallet.writeContract({
    address: market, abi: marketAbi, functionName: "claim",
    args: [BigInt(marketId)],
    chain, account,
  });
  const receipt = await reader().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("the claim reverted on chain");
  return hash;
}

/** Testnet only: the stand-in USDG hands out play money to anybody. */
export async function faucetUSDG(): Promise<Hash> {
  const { account, wallet } = await walletClient();
  const hash = await wallet.writeContract({
    address: USDG,
    abi: [{ type: "function", name: "faucet", inputs: [], outputs: [], stateMutability: "nonpayable" }],
    functionName: "faucet", args: [], chain, account,
  });
  await reader().waitForTransactionReceipt({ hash });
  return hash;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
