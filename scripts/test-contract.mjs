/**
 * Exercises FomoMarket against a local EVM before it goes anywhere that
 * costs money. Checks the arithmetic of a settled pot, both refund paths,
 * the empty-side auto-void, and — the one that matters most — that the
 * contract never pays out more than it was given.
 *
 *   npx hardhat node          # in another shell
 *   node scripts/test-contract.mjs
 */
import { createWalletClient, createPublicClient, http, defineChain, parseUnits, formatUnits, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { artifacts } from "../lib/artifacts.cjs";

const local = defineChain({
  id: 31337, name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // oracle / deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // punter A
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // punter B
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // bystander
];

const pub = createPublicClient({ chain: local, transport: http() });
const wallets = KEYS.map((k) =>
  createWalletClient({ account: privateKeyToAccount(k), chain: local, transport: http() }));
const [oracle, a, b, bystander] = wallets;

const usd = (n) => parseUnits(String(n), 6);
const num = (v) => Number(formatUnits(v, 6));

let failures = 0;
function check(name, got, want, tol = 0) {
  const ok = typeof got === "number" && typeof want === "number"
    ? Math.abs(got - want) <= (tol || 1e-9)
    : got === want;
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"} ${name}${ok ? "" : `  got ${got} want ${want}`}`);
}
async function expectRevert(name, p) {
  try { await p; failures++; console.log(`  FAIL ${name} — did not revert`); }
  catch { console.log(`  ok  ${name} reverts`); }
}

async function deploy(artifact, args) {
  const hash = await oracle.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
  return contractAddress;
}

const send = async (wallet, address, abi, functionName, args) => {
  const hash = await wallet.writeContract({ address, abi, functionName, args, chain: local });
  return pub.waitForTransactionReceipt({ hash });
};

async function mine(seconds) {
  await fetch("http://127.0.0.1:8545", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [seconds] }),
  });
  await fetch("http://127.0.0.1:8545", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] }),
  });
}

const now = async () => Number((await pub.getBlock()).timestamp);

/* ------------------------------------------------------------------ */

const USDG = artifacts.MockUSDG;
const MKT = artifacts.FomoMarket;

const usdg = await deploy(USDG, []);
const market = await deploy(MKT, [usdg, oracle.account.address, oracle.account.address]);
console.log("USDG   ", usdg);
console.log("Market ", market, "\n");

for (const w of [a, b, bystander]) {
  await send(w, usdg, USDG.abi, "faucet", []);
  await send(w, usdg, USDG.abi, "approve", [market, 2n ** 255n]);
}

const read = (fn, args) => pub.readContract({ address: market, abi: MKT.abi, functionName: fn, args });

/* ---------------------------------------------- 1. a pot that settles */
console.log("a market that settles");
{
  const t = await now();
  await send(oracle, market, MKT.abi, "openMarket", ["unipcs", 86400, t, t + 86400, usd(15_100_000)]);
  const id = 0n;

  await send(a, market, MKT.abi, "stake", [id, 0, usd(100)]);
  await send(b, market, MKT.abi, "stake", [id, 1, usd(300)]);

  const m = await read("getMarket", [id]);
  check("pool up", num(m.poolUp), 100);
  check("pool down", num(m.poolDown), 300);

  // 100 up against 300 down: 100 back, 300 won, 2% of the winnings taken
  const q = await read("quote", [id, 0, usd(100)]);
  check("quote up on a 100 ticket", Number(q) / 1e18, 1 + (150 * 0.98) / 100, 1e-6);

  await expectRevert("resolving before the close", send(oracle, market, MKT.abi, "resolve", [id, usd(16_000_000)]));

  await mine(86401);
  await send(oracle, market, MKT.abi, "resolve", [id, usd(16_000_000)]);
  const r = await read("getMarket", [id]);
  check("status resolved", r.status, 1);
  check("winner is up", r.winner, 0);

  const [claimA] = await read("claimable", [id, a.account.address]);
  check("A is owed stake plus the pot less the fee", num(claimA), 100 + 300 * 0.98);

  const before = await pub.readContract({ address: usdg, abi: USDG.abi, functionName: "balanceOf", args: [a.account.address] });
  await send(a, market, MKT.abi, "claim", [id]);
  const after = await pub.readContract({ address: usdg, abi: USDG.abi, functionName: "balanceOf", args: [a.account.address] });
  check("A was paid", num(after - before), 394);

  await expectRevert("claiming twice", send(a, market, MKT.abi, "claim", [id]));
  await expectRevert("the losing side claiming", send(b, market, MKT.abi, "claim", [id]));

  const held = await pub.readContract({ address: usdg, abi: USDG.abi, functionName: "balanceOf", args: [market] });
  check("only the fee is left behind", num(held), 6);

  const escrow = await read("escrowOf", [keccak256(toHex("unipcs"))]);
  check("half the fee is held for the handle", num(escrow), 3);
  check("the other half is the venue's", num(await read("feeAccrued", [])), 3);

  await send(oracle, market, MKT.abi, "setHandleOwner", [keccak256(toHex("unipcs")), bystander.account.address]);
  await send(bystander, market, MKT.abi, "claimEscrow", [keccak256(toHex("unipcs"))]);
  await send(oracle, market, MKT.abi, "withdrawFees", []);
  check("the contract ends empty", num(await pub.readContract({ address: usdg, abi: USDG.abi, functionName: "balanceOf", args: [market] })), 0);
}

/* ------------------------------------------------------- 2. a void */
console.log("\na market that voids");
{
  const t = await now();
  await send(oracle, market, MKT.abi, "openMarket", ["ogle", 86400, t, t + 86400, usd(1_000)]);
  const id = 1n;
  await send(a, market, MKT.abi, "stake", [id, 0, usd(250)]);
  await send(b, market, MKT.abi, "stake", [id, 1, usd(75)]);
  await send(oracle, market, MKT.abi, "voidMarket", [id, "the reading stopped"]);

  const [ca] = await read("claimable", [id, a.account.address]);
  const [cb] = await read("claimable", [id, b.account.address]);
  check("A gets back exactly what it cost", num(ca), 250);
  check("B gets back exactly what it cost", num(cb), 75);
  await send(a, market, MKT.abi, "claim", [id]);
  await send(b, market, MKT.abi, "claim", [id]);
  check("nothing is left over", num(await pub.readContract({ address: usdg, abi: USDG.abi, functionName: "balanceOf", args: [market] })), 0);
}

/* ------------------------------------ 3. a side nobody ever took */
console.log("\na market where one side never traded");
{
  const t = await now();
  await send(oracle, market, MKT.abi, "openMarket", ["frank", 86400, t, t + 86400, usd(500)]);
  const id = 2n;
  await send(a, market, MKT.abi, "stake", [id, 0, usd(40)]);
  await mine(86401);
  await send(oracle, market, MKT.abi, "resolve", [id, usd(9_999)]);
  const m = await read("getMarket", [id]);
  check("it voided rather than paying a free round trip", m.status, 2);
  const [ca] = await read("claimable", [id, a.account.address]);
  check("the stake comes back", num(ca), 40);
  await send(a, market, MKT.abi, "claim", [id]);
}

/* ------------------------------------------ 4. an absent oracle */
console.log("\nan oracle that never came back");
{
  const t = await now();
  await send(oracle, market, MKT.abi, "openMarket", ["burgz", 604800, t, t + 604800, usd(10)]);
  const id = 3n;
  await send(a, market, MKT.abi, "stake", [id, 0, usd(10)]);
  await send(b, market, MKT.abi, "stake", [id, 1, usd(10)]);
  await mine(604800 + 10);
  await expectRevert("voiding early", send(bystander, market, MKT.abi, "voidStale", [id]));
  await mine(7 * 86400 + 10);
  await send(bystander, market, MKT.abi, "voidStale", [id]);
  check("a stranger could unstick it", (await read("getMarket", [id])).status, 2);
  await send(a, market, MKT.abi, "claim", [id]);
  await send(b, market, MKT.abi, "claim", [id]);
  check("both stakes came back", num(await pub.readContract({ address: usdg, abi: USDG.abi, functionName: "balanceOf", args: [market] })), 0);
}

/* -------------------------------------------- 5. the house rules */
console.log("\nwhat the contract refuses");
{
  const t = await now();
  await send(oracle, market, MKT.abi, "openMarket", ["salem", 86400, t, t + 86400, usd(1)]);
  const id = 4n;
  await expectRevert("a stranger opening a market", send(a, market, MKT.abi, "openMarket", ["x", 86400, t, t + 86400, 0n]));
  await expectRevert("a stranger resolving", send(a, market, MKT.abi, "resolve", [id, 0n]));
  await expectRevert("a third side", send(a, market, MKT.abi, "stake", [id, 2, usd(1)]));
  await expectRevert("a zero ticket", send(a, market, MKT.abi, "stake", [id, 0, 0n]));
  await expectRevert("a window nobody offers", send(oracle, market, MKT.abi, "openMarket", ["x", 3600, t, t + 3600, 0n]));

  await send(oracle, market, MKT.abi, "setHandleOwner", [keccak256(toHex("salem")), b.account.address]);
  await send(b, market, MKT.abi, "setBlocked", [keccak256(toHex("salem")), true]);
  await expectRevert("a market on a handle that opted out", send(oracle, market, MKT.abi, "openMarket", ["salem", 86400, t, t + 86400, 0n]));

  await mine(86401);
  await expectRevert("a ticket after the close", send(a, market, MKT.abi, "stake", [id, 0, usd(1)]));
}

console.log(`\n${failures === 0 ? "all good" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
