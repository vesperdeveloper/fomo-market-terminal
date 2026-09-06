import { NextResponse } from "next/server";
import { erc20Abi } from "viem";
import {
  chain, isTestnet, marketAddress, oracleAccount, oracleGas,
  publicClient, USDG, fromUnits,
} from "@/lib/chain";
import { readMarkets, marketAbi } from "@/lib/onchain";

export const dynamic = "force-dynamic";

/**
 * What this deployment actually is.
 *
 * A venue that settles on chain should be checkable without trusting the
 * page: the contract address, the chain it is on, what it is holding, and
 * whether the oracle still has the gas to keep publishing.
 */
export async function GET() {
  const address = marketAddress();
  if (!address) {
    return NextResponse.json({
      live: false,
      chainId: chain.id,
      reason: "no market contract is configured for this deployment",
    });
  }

  const oracle = oracleAccount();
  const [markets, held, gas, fees] = await Promise.all([
    readMarkets(),
    publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    oracleGas(),
    publicClient.readContract({ address, abi: marketAbi, functionName: "feeAccrued" }) as Promise<bigint>,
  ]);

  const open = markets.filter((m) => m.status === "open");
  const pot = markets.reduce((s, m) => s + m.volume, 0);

  return NextResponse.json({
    live: true,
    testnet: isTestnet,
    chainId: chain.id,
    chainName: chain.name,
    contract: address,
    explorer: `${chain.blockExplorers!.default.url}/address/${address}`,
    collateral: USDG,
    oracle: oracle?.address ?? null,
    oracleGas: gas,
    // an oracle out of gas cannot open or settle anything, which is the one
    // failure that looks like nothing being wrong
    publishing: gas > 0,
    markets: { total: markets.length, open: open.length },
    staked: pot,
    held: fromUnits(held as bigint),
    feeAccrued: fromUnits(fees),
  });
}
