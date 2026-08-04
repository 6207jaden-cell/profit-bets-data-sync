// Experiment 3 (Trading Cost Reality Test). Two things live here:
//   1. A documented fee model (estimateFees) — this platform has never
//      modeled fees at all before now, only slippage.
//   2. computeCostRealityReport — separates closed trades by session type
//      (scalp/swing/crypto) and reports gross (before-cost) vs net
//      (after-cost) expectancy for each, answering the actual question
//      Experiment 3 exists for: does each strategy still have positive
//      expectancy once realistic costs are subtracted?
// See HYPOTHESIS_LOG.md H8, EXPERIMENTS.md E-07 for the related slippage-
// model-calibration hypothesis this complements.

const OPTIONS_INSTRUMENTS = new Set(["call", "put", "call_spread", "put_spread", "iron_condor"]);

/**
 * Modeled round-trip fee in dollars. Stocks/ETFs/crypto are assumed
 * commission-free — this matches Robinhood's actual fee structure, and
 * Robinhood is the live-execution broker this platform targets, so the
 * assumption is not arbitrary. Options use a documented $0.65/contract
 * industry-standard estimate, charged on both the opening and closing leg,
 * scaled by the number of legs for spreads. This is a modeling assumption,
 * not calibrated against real fills — same honest caveat as the slippage
 * model in slippage.ts.
 */
export function estimateFees(instrument: string, contracts = 1): number {
  const isOption = OPTIONS_INSTRUMENTS.has(instrument);
  if (!isOption) return 0;
  const perContractFee = 0.65;
  const legs = instrument === "call_spread" || instrument === "put_spread" ? 2
    : instrument === "iron_condor" ? 4
    : 1;
  return perContractFee * legs * Math.max(1, contracts) * 2; // *2 for open + close leg
}

export type CostRealityInput = {
  side: string;
  entry_price: number;
  exit_price: number | null;
  entry_quoted_price: number | null;
  exit_quoted_price: number | null;
  estimated_fees: number | null;
  rationale: string | null;
  created_at: string;
  closed_at: string | null;
};

export type CostRealityGroup = {
  sessionType: "scalp" | "swing" | "crypto" | "other";
  tradeCount: number;
  tradesWithCostData: number; // how many actually have entry/exit_quoted_price populated (post-Experiment-3 trades only)
  avgHoldingHours: number;
  /** Average % return using PRE-slippage quoted prices — what the raw signal would have earned with zero cost of trading. */
  avgGrossReturnPct: number;
  /** Average % return using the ACTUAL realized entry/exit prices (slippage already baked in) — what was really earned. */
  avgNetReturnPct: number;
  /** avgGrossReturnPct - the net return of the SAME cost-tracked subset — isolates slippage's specific cost, in percentage points. */
  avgSlippageCostPct: number;
  avgFeesUsd: number;
  /** True if avgNetReturnPct > 0 — the actual answer to "does this session type still have positive expectancy after realistic costs." */
  stillPositiveAfterCosts: boolean;
};

function sessionTypeFromRationale(rationale: string | null): "scalp" | "swing" | "crypto" | "other" {
  const r = rationale ?? "";
  if (r.includes("[SCALP]")) return "scalp";
  if (r.includes("[CRYPTO]")) return "crypto";
  if (r.includes("[SWING]")) return "swing";
  return "other";
}

/**
 * Groups closed trades by session type and computes gross vs net
 * expectancy for each. "Expectancy" here is simply the mean return per
 * trade across the group — mathematically equivalent to
 * win_rate*avg_win - loss_rate*avg_loss, no separate calculation needed.
 * Gross-return figures are only computable for trades with cost data
 * populated (post-Experiment-3 trades) — reported alongside net figures
 * (computable for ALL closed trades, cost-tracked or not) so the report
 * is honest about its own coverage rather than silently mixing eras.
 */
export function computeCostRealityReport(trades: CostRealityInput[]): CostRealityGroup[] {
  const groups: Record<string, CostRealityInput[]> = { scalp: [], swing: [], crypto: [], other: [] };
  for (const t of trades) groups[sessionTypeFromRationale(t.rationale)].push(t);

  const results: CostRealityGroup[] = [];

  for (const sessionType of ["scalp", "swing", "crypto", "other"] as const) {
    const group = groups[sessionType];
    if (group.length === 0) continue;

    let sumNetPct = 0;
    let sumHoldHours = 0;
    let holdCount = 0;

    for (const t of group) {
      const dir = t.side === "buy" ? 1 : -1;
      const exit = t.exit_price ?? t.entry_price;
      const netPct = t.entry_price > 0 ? ((exit - t.entry_price) / t.entry_price) * 100 * dir : 0;
      sumNetPct += netPct;
      if (t.closed_at) {
        sumHoldHours += (new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000;
        holdCount++;
      }
    }

    const withCostData = group.filter((t) => t.entry_quoted_price != null && t.exit_quoted_price != null);
    let sumGrossPct = 0;
    let sumNetPctForCostSubset = 0;
    let sumFees = 0;

    for (const t of withCostData) {
      const dir = t.side === "buy" ? 1 : -1;
      const grossExit = t.exit_quoted_price as number;
      const grossEntry = t.entry_quoted_price as number;
      const grossPct = grossEntry > 0 ? ((grossExit - grossEntry) / grossEntry) * 100 * dir : 0;
      sumGrossPct += grossPct;

      const netExit = t.exit_price ?? t.entry_price;
      const netPct = t.entry_price > 0 ? ((netExit - t.entry_price) / t.entry_price) * 100 * dir : 0;
      sumNetPctForCostSubset += netPct;

      sumFees += t.estimated_fees ?? 0;
    }

    const n = group.length;
    const nCost = withCostData.length;
    const avgGross = nCost > 0 ? sumGrossPct / nCost : 0;
    const avgNetForCostSubset = nCost > 0 ? sumNetPctForCostSubset / nCost : 0;

    results.push({
      sessionType,
      tradeCount: n,
      tradesWithCostData: nCost,
      avgHoldingHours: holdCount > 0 ? Number((sumHoldHours / holdCount).toFixed(1)) : 0,
      avgGrossReturnPct: Number(avgGross.toFixed(3)),
      avgNetReturnPct: Number((sumNetPct / n).toFixed(3)),
      avgSlippageCostPct: Number((avgGross - avgNetForCostSubset).toFixed(3)),
      avgFeesUsd: nCost > 0 ? Number((sumFees / nCost).toFixed(2)) : 0,
      stillPositiveAfterCosts: sumNetPct / n > 0,
    });
  }

  return results;
}
