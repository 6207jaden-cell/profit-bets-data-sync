// Realistic slippage modeling for paper trade fills. Without this, every
// paper fill happens at the exact quoted price — which makes every P&L
// number in the app systematically optimistic vs. what would actually
// happen with real money, especially on smaller-cap stocks and altcoins
// with thinner order books. This doesn't need to be perfectly precise to be
// valuable — even a reasonable, honest estimate makes the paper numbers a
// meaningfully better predictor of live performance than assuming zero cost
// of trading exists.
//
// Two components, standard market-microstructure model:
//   1. Base spread cost — the cost of just crossing the bid-ask spread,
//      varies by asset class and liquidity tier
//   2. Market impact — additional cost from your own order size relative to
//      the day's typical volume, modeled with a square-root function (the
//      standard form: impact grows with the square root of participation
//      rate, not linearly — doubling order size doesn't double impact)

export type SlippageEstimate = {
  slippageBps: number;
  reason: string;
};

/**
 * Estimates round-trip-equivalent slippage in basis points for a single
 * order. avgDailyVolume is optional and degrades gracefully — when unknown
 * (e.g. at exit time when a fresh volume fetch wasn't done), falls back to a
 * moderate-liquidity assumption rather than failing or assuming zero cost.
 */
export function estimateSlippageBps(params: {
  orderNotional: number;
  avgDailyVolume?: number | null; // shares/units per day
  price: number;
  isCrypto: boolean;
}): SlippageEstimate {
  const { orderNotional, avgDailyVolume, price, isCrypto } = params;
  const avgDailyDollarVolume = avgDailyVolume != null && avgDailyVolume > 0 ? avgDailyVolume * price : null;

  // Base spread cost (bps) — crypto majors trade with wider spreads than
  // large-cap stocks even at normal liquidity.
  const baseSpreadBps = isCrypto ? 6 : 2;

  // Liquidity tier multiplier on the base spread — thin names have
  // meaningfully wider real-world spreads than the base assumption.
  let liquidityMultiplier: number;
  let tierLabel: string;
  if (avgDailyDollarVolume == null) {
    liquidityMultiplier = isCrypto ? 2.5 : 2.0; // unknown volume — assume moderate-thin, don't assume best-case
    tierLabel = "unknown liquidity (conservative default)";
  } else if (avgDailyDollarVolume > 50_000_000) {
    liquidityMultiplier = 1.0;
    tierLabel = "highly liquid";
  } else if (avgDailyDollarVolume > 5_000_000) {
    liquidityMultiplier = 1.5;
    tierLabel = "moderately liquid";
  } else if (avgDailyDollarVolume > 500_000) {
    liquidityMultiplier = 3.0;
    tierLabel = "thin";
  } else {
    liquidityMultiplier = 6.0;
    tierLabel = "very thin";
  }

  // Market impact — square-root model. participationRate is this order's
  // size as a fraction of the day's typical dollar volume; sqrt means impact
  // grows sub-linearly with size (a 4x bigger order costs ~2x more impact,
  // not 4x), which matches observed market behavior far better than a
  // linear assumption would.
  const participationRate = avgDailyDollarVolume != null && avgDailyDollarVolume > 0
    ? orderNotional / avgDailyDollarVolume
    : 0.01; // assume a modest 1% participation rate when volume is unknown
  const impactBps = 15 * Math.sqrt(Math.max(0, participationRate));

  const totalBps = Math.min(baseSpreadBps * liquidityMultiplier + impactBps, 300); // cap at 3% as a sanity bound

  return {
    slippageBps: Number(totalBps.toFixed(1)),
    reason: `${tierLabel}, ${(participationRate * 100).toFixed(2)}% of daily volume`,
  };
}

/**
 * Applies estimated slippage to a quoted price to get a realistic fill
 * price. Buying costs slightly more than quoted (adverse fill); selling
 * receives slightly less — both directions make the trader marginally
 * worse off, which is the honest direction for a cost-of-trading model.
 */
export function applySlippage(price: number, side: "buy" | "sell", slippageBps: number): number {
  const factor = slippageBps / 10_000;
  return side === "buy" ? price * (1 + factor) : price * (1 - factor);
}
