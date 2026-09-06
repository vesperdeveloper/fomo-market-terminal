#!/usr/bin/env node
/**
 * Put FomoMarket on a chain.
 *
 *   node scripts/deploy-contract.mjs                 # whatever .env.local says
 *   CHAIN=testnet node scripts/deploy-contract.mjs   # Robinhood Chain testnet
 *   CHAIN=mainnet node scripts/deploy-contract.mjs   # Robinhood Chain
 *
 * On the testnet it also deploys a stand-in USDG, because the real one does
 * not exist there. On mainnet it refuses to: the collateral has to be the
 * token people actually hold, not one this script invented.
 *
 * The deployer key is the oracle key. It needs native ETH for gas and nothing
 * else — it never holds collateral, and the contract gives it no way to.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, defineChain, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { artifacts } from "../lib/artifacts.cjs";

/* ------------------------------------------------------------------ env */

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const NETS = {
  mainnet: {
    id: 4663, name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  },
  testnet: {
    id: 46630, name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://robinhoodchain-testnet.blockscout.com",
    usdg: null,                       // deployed below
  },
};

const which = (process.env.CHAIN
  ?? (Number(process.env.NEXT_PUBLIC_CHAIN_ID) === 46630 ? "testnet" : "mainnet")).toLowerCase();
const net = NETS[which];
if (!net) { console.error(`unknown chain "${which}" — use mainnet or testnet`); process.exit(1); }

const chain = defineChain({
  id: net.id, name: net.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [net.rpc] } },
  blockExplorers: { default: { name: "Blockscout", url: net.explorer } },
});

const key = process.env.ORACLE_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY;
if (!key) { console.error("ORACLE_PRIVATE_KEY (or TREASURY_PRIVATE_KEY) is not set"); process.exit(1); }
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);

const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });

/* --------------------------------------------------------------- deploy */

const gas = await pub.getBalance({ address: account.address });
console.log(`network   ${net.name} (${net.id})`);
console.log(`deployer  ${account.address}`);
console.log(`gas       ${formatEther(gas)} ETH\n`);

if (gas === 0n) {
  console.error("The deployer has no ETH, so nothing can be deployed.");
  console.error(which === "testnet"
    ? `Fund it at https://faucet.testnet.chain.robinhood.com (0.01 ETH is plenty).`
    : `Send a little ETH on Robinhood Chain to ${account.address} — a deploy costs well under 0.01.`);
  process.exit(1);
}

async function deploy(name, args) {
  const a = artifacts[name];
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account, chain });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${name} deployment reverted`);
  console.log(`${name.padEnd(11)} ${receipt.contractAddress}   ${net.explorer}/tx/${hash}`);
  return receipt.contractAddress;
}

let usdg = process.env.DEPLOY_USDG ?? net.usdg;
if (!usdg) {
  if (which !== "testnet") throw new Error("no collateral address for this network");
  usdg = await deploy("MockUSDG", []);
}

const feeTo = process.env.FEE_TO ?? account.address;
const market = await deploy("FomoMarket", [usdg, account.address, feeTo]);

/* ------------------------------------------------------------- record it */

const vars = {
  NEXT_PUBLIC_CHAIN_ID: String(net.id),
  NEXT_PUBLIC_USDG: usdg,
  NEXT_PUBLIC_MARKET_ADDRESS: market,
};

if (existsSync(".env.local")) {
  let env = readFileSync(".env.local", "utf8");
  for (const [k, v] of Object.entries(vars)) {
    env = env.match(new RegExp(`^${k}=.*$`, "m"))
      ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
      : env.replace(/\s*$/, `\n${k}=${v}\n`);
  }
  writeFileSync(".env.local", env);
  console.log("\nwrote .env.local");
}

console.log("\nSet these on the deployment too:");
for (const [k, v] of Object.entries(vars)) console.log(`  ${k}=${v}`);
console.log(`\nOracle is ${account.address} — keep it in ETH or it stops publishing.`);
