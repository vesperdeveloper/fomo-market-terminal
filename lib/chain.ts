import {
  createPublicClient, createWalletClient, http, defineChain,
  parseUnits, formatUnits, getAddress, erc20Abi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Which chain this deployment lives on.
 *
 * Robinhood Chain has a mainnet and a testnet, and the only differences that
 * matter here are the RPC, the id, and which USDG the pots are denominated
 * in. Everything downstream reads these three values rather than hard-coding
 * a network, so moving between them is a change of environment, not of code.
 */
const MAINNET = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const TESTNET = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain-testnet.blockscout.com" },
  },
});

/** The id is public because the browser has to ask a wallet to switch to it. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
export const chain = CHAIN_ID === TESTNET.id ? TESTNET : MAINNET;
export const isTestnet = CHAIN_ID === TESTNET.id;

/** Collateral. Six decimals on both networks, so every conversion goes
 *  through the helpers below rather than a hand-written 1e18. */
export const USDG = getAddress(
  process.env.NEXT_PUBLIC_USDG ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
) as Address;
export const USDG_DECIMALS = 6;

/** The market contract. Absent until one has been deployed. */
export function marketAddress(): Address | null {
  const a = process.env.NEXT_PUBLIC_MARKET_ADDRESS;
  if (!a) return null;
  try { return getAddress(a); } catch { return null; }
}

export const toUnits = (usd: number): bigint =>
  parseUnits(usd.toFixed(USDG_DECIMALS), USDG_DECIMALS);

export const fromUnits = (units: bigint): number =>
  Number(formatUnits(units, USDG_DECIMALS));

/**
 * Reads are batched into one HTTP request. A board is twenty markets plus
 * whatever the visitor holds, which is forty round trips if each read goes
 * on its own — enough to be the slowest thing on the page.
 */
export const publicClient = createPublicClient({
  chain,
  transport: http(process.env.RH_RPC_URL || undefined, { batch: { wait: 8 } }),
});

/**
 * The oracle signer. This key opens markets and publishes the number they
 * settle on. What it deliberately cannot do — because the contract does not
 * offer it a way — is move a stake, pay itself, or resolve a market that has
 * not closed. It is read only on the server and never returned to a caller.
 */
export function oracleAccount() {
  const k = process.env.ORACLE_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY;
  if (!k) return null;
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return privateKeyToAccount(hex);
}

export function oracleWallet() {
  const account = oracleAccount();
  if (!account) return null;
  return createWalletClient({ account, chain, transport: http(process.env.RH_RPC_URL || undefined) });
}

/** Native balance of the oracle, in ETH. Opening and resolving cost gas;
 *  an oracle with none looks configured and quietly stops working. */
export async function oracleGas(): Promise<number> {
  const a = oracleAccount();
  if (!a) return 0;
  return Number(await publicClient.getBalance({ address: a.address })) / 1e18;
}

export async function usdgBalanceOf(address: Address): Promise<number> {
  const bal = await publicClient.readContract({
    address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address],
  });
  return fromUnits(bal);
}

export const explorerTx = (h: string) =>
  `${chain.blockExplorers!.default.url}/tx/${h}`;
export const explorerAddress = (a: string) =>
  `${chain.blockExplorers!.default.url}/address/${a}`;

/** True when there is a contract to trade against. */
export const chainReady = () => marketAddress() !== null;
