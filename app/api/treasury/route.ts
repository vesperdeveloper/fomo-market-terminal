import { NextResponse } from "next/server";
import { ready } from "@/lib/runtime";
import { treasuryAddress, treasuryBalance, treasuryGas, chainReady } from "@/lib/chain";
import { worstCaseLiability, RESERVE_BUFFER, unbackedAllowed } from "@/lib/solvency";

export const dynamic = "force-dynamic";

/**
 * What the book owes against what the treasury holds.
 *
 * Published rather than kept internal: a venue that pays winners out of a
 * single wallet is only as good as that wallet, so the number that matters
 * is the one anybody can check against the chain.
 */
export async function GET() {
  const address = treasuryAddress();
  if (!chainReady() || !address) {
    return NextResponse.json({
      live: false,
      reason: "this deployment is not configured to take real money",
    });
  }

  const { store } = await ready();
  const [markets, positions, balance, gas] = await Promise.all([
    store.getMarkets(), store.getPositions(), treasuryBalance(), treasuryGas(),
  ]);

  const liability = worstCaseLiability(markets, positions);
  const usable = balance * (1 - RESERVE_BUFFER);

  return NextResponse.json({
    live: true,
    address,
    collateral: balance,
    liability,
    headroom: Math.max(0, usable - liability),
    covered: liability === 0 ? 1 : Math.min(1, usable / liability),
    gas,
    // a transfer costs gas, so no ETH means no payouts however much USDG is held
    canPay: gas > 0,
    // when true the book may take stakes it cannot currently cover, and the
    // shortfall is settled by the operator rather than by the contract
    unbacked: unbackedAllowed(),
    chainId: 4663,
    token: "USDG",
  });
}
