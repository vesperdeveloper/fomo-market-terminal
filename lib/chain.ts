import {
  createPublicClient, createWalletClient, http, defineChain,
  parseUnits, formatUnits, getAddress, erc20Abi,
  type Address, type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Robinhood Chain. USDG is the collateral every market is priced and
 * settled in; it carries SIX decimals, not eighteen, so every conversion
 * goes through the helpers below rather than a hand-written 1e18.
 */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const USDG_DECIMALS = 6;

/** Transfer(address,address,uint256) */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const toUnits = (usd: number): bigint =>
  parseUnits(usd.toFixed(USDG_DECIMALS), USDG_DECIMALS);

export const fromUnits = (units: bigint): number =>
  Number(formatUnits(units, USDG_DECIMALS));

export const publicClient = createPublicClient({
  chain: robinhood,
  transport: http(process.env.RH_RPC_URL || undefined),
});

/** Address every stake is paid into and every payout is paid out of. */
export function treasuryAddress(): Address | null {
  const a = process.env.TREASURY_ADDRESS;
  if (!a) return null;
  try { return getAddress(a); } catch { return null; }
}

/**
 * Signer for payouts. This key can move every dollar the treasury holds,
 * so it is read only on the server and never returned to a caller. A
 * deployment without it can still take deposits and settle markets - it
 * simply cannot pay, which fails loudly at redemption instead of quietly
 * at deposit.
 */
export function treasuryAccount() {
  const k = process.env.TREASURY_PRIVATE_KEY;
  if (!k) return null;
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return privateKeyToAccount(hex);
}

export function walletClient() {
  const account = treasuryAccount();
  if (!account) return null;
  return createWalletClient({
    account, chain: robinhood,
    transport: http(process.env.RH_RPC_URL || undefined),
  });
}

/** Live USDG the treasury actually holds. This is what bounds solvency. */
export async function treasuryBalance(): Promise<number> {
  const t = treasuryAddress();
  if (!t) return 0;
  const bal = await publicClient.readContract({
    address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [t],
  });
  return fromUnits(bal);
}

/**
 * Native balance of the treasury, in ETH.
 *
 * Paying a winner is an ERC-20 transfer, which costs gas. A treasury full
 * of USDG and empty of ETH looks solvent and cannot pay anybody, so this
 * is reported next to the collateral rather than discovered at redemption.
 */
export async function treasuryGas(): Promise<number> {
  const t = treasuryAddress();
  if (!t) return 0;
  const wei = await publicClient.getBalance({ address: t });
  return Number(wei) / 1e18;
}

export const explorerAddress = (a: string) =>
  `${robinhood.blockExplorers.default.url}/address/${a}`;

export const explorerTx = (h: string) =>
  `${robinhood.blockExplorers.default.url}/tx/${h}`;

export interface VerifiedDeposit {
  from: Address;
  amount: number;
  blockNumber: bigint;
}

/**
 * Confirm that `hash` really moved `expected` USDG into the treasury.
 *
 * Everything a caller claims about a payment is checked against the chain
 * here - the token, the recipient, the amount and the payer - because the
 * only thing a browser can be trusted to supply is the hash itself. A
 * mismatch is refused rather than rounded into agreement.
 */
export async function verifyDeposit(
  hash: Hash, expected: number, claimedFrom?: string,
): Promise<VerifiedDeposit> {
  const treasury = treasuryAddress();
  if (!treasury) throw new Error("treasury address is not configured");

  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("that transaction reverted");

  const want = toUnits(expected);
  const usdg = USDG.toLowerCase();

  // Every USDG transfer into the treasury in this transaction, not just the
  // first: one that carries several is still a valid payment as long as one
  // of them is the stake.
  const paid: { from: Address; value: bigint }[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdg) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    if (getAddress(`0x${log.topics[2]!.slice(26)}`) !== treasury) continue;
    paid.push({ from: getAddress(`0x${log.topics[1]!.slice(26)}`), value: BigInt(log.data) });
  }

  if (!paid.length) throw new Error("no USDG transfer to the treasury in that transaction");

  const fromRight = claimedFrom
    ? paid.filter((p) => p.from.toLowerCase() === claimedFrom.toLowerCase())
    : paid;
  if (!fromRight.length) throw new Error("that payment came from a different wallet");

  // exact match: a stake short by a rounding step is not the stake
  const match = fromRight.find((p) => p.value === want);
  if (!match) {
    const best = fromRight[0].value;
    throw new Error(
      `payment was ${fromUnits(best)} USDG but the ticket was ${expected} USDG`,
    );
  }

  return { from: match.from, amount: fromUnits(match.value), blockNumber: receipt.blockNumber };
}

/** Pay `usd` USDG out of the treasury to `to`. Returns the transaction hash. */
export async function sendPayout(to: string, usd: number): Promise<Hash> {
  const wallet = walletClient();
  if (!wallet) throw new Error("treasury signer is not configured");
  if (!(usd > 0)) throw new Error("payout must be positive");

  const amount = toUnits(usd);
  const [held, gas] = await Promise.all([treasuryBalance(), treasuryGas()]);
  if (held < usd) {
    throw new Error(`treasury holds ${held} USDG, cannot pay ${usd} USDG`);
  }
  if (gas <= 0) {
    throw new Error("treasury has no ETH for gas, so it cannot send a transfer");
  }

  return wallet.writeContract({
    address: USDG, abi: erc20Abi, functionName: "transfer",
    args: [getAddress(to), amount],
    chain: robinhood, account: wallet.account,
  });
}

/** True when the deployment can actually take and return real money. */
export const chainReady = () =>
  Boolean(treasuryAddress()) && Boolean(process.env.TREASURY_PRIVATE_KEY);
