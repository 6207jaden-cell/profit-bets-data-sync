// Stage 3: Exposure — a genuinely different data shape than everything
// else built in Stage 3 so far: this reads CURRENT open positions and
// current portfolio balance, not historical closed trades. Answers "how
// much of the portfolio is actually at risk right now, and how
// concentrated is that risk," not "how did past trades perform."

import { classifyAssetClass, type AssetClass } from "@/lib/portfolio-attribution";

type SupabaseAdminClient = any; // same documented pattern as the other Stage 3 modules

export type ExposureByAssetClass = {
  assetClass: AssetClass;
  valueDollar: number;
  pctOfDeployed: number;
};

export type ExposureResult = {
  totalEquity: number;
  cashBalance: number;
  deployedValue: number;
  cashPct: number;
  deployedPct: number;
  openPositionCount: number;
  /** Largest single position as a % of total DEPLOYED capital (not total equity) — null when there are no open positions. */
  largestPositionPct: number | null;
  /**
   * Herfindahl-Hirschman Index of position sizes — sum of each position's
   * squared percentage share of deployed capital. Standard concentration
   * measure (same formula used in antitrust economics for market
   * concentration, applied here to position sizing instead). Ranges 0
   * (infinitely diversified) to 10000 (a single position holding
   * everything). As a rough reference: below ~1500 is commonly considered
   * unconcentrated, 1500-2500 moderately concentrated, above 2500 highly
   * concentrated — though those thresholds come from a different domain
   * and are offered as context, not a hard rule for this system.
   */
  concentrationHHI: number | null;
  byAssetClass: ExposureByAssetClass[];
};

/**
 * Uses ENTRY VALUE (quantity × entry_price) as the position-size basis,
 * not live mark-to-market value. This is a deliberate simplification
 * worth stating plainly: the actual current value of an open position
 * will differ from its entry value as price moves, but for an exposure/
 * concentration analysis specifically, entry-basis sizing more directly
 * reflects the actual risk-allocation DECISION made at entry — the
 * question this answers is "how much capital did the system choose to
 * commit to this," not "what is this worth this second," and computing
 * the latter would require a live quote fetch for every open position on
 * every panel load, a real cost/latency tradeoff not justified for this
 * specific analysis.
 */
export async function computeExposure(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
): Promise<ExposureResult | null> {
  const { data: portfolio } = await supabaseAdmin
    .from("paper_portfolios")
    .select("balance, equity")
    .eq("user_id", userId)
    .maybeSingle();
  if (!portfolio) return null;

  const { data: openTrades } = await supabaseAdmin
    .from("paper_trades")
    .select("quantity, entry_price, asset, instrument")
    .eq("user_id", userId)
    .eq("is_open", true);

  const trades = (openTrades ?? []) as Array<{ quantity: number | string; entry_price: number | string; asset: string; instrument: string | null }>;
  const positions = trades.map((t) => ({
    value: Number(t.quantity) * Number(t.entry_price),
    assetClass: classifyAssetClass(t.instrument),
  })).filter((p) => Number.isFinite(p.value) && p.value > 0);

  const deployedValue = positions.reduce((s, p) => s + p.value, 0);
  const totalEquity = Number(portfolio.equity ?? portfolio.balance ?? 0);
  const cashBalance = Number(portfolio.balance ?? 0);

  const largestPosition = positions.length > 0 ? Math.max(...positions.map((p) => p.value)) : 0;
  const largestPositionPct = (positions.length > 0 && deployedValue > 0)
    ? Number(((largestPosition / deployedValue) * 100).toFixed(1)) : null;

  const concentrationHHI = deployedValue > 0
    ? Number(positions.reduce((s, p) => s + ((p.value / deployedValue) * 100) ** 2, 0).toFixed(0))
    : null;

  const byAssetClassMap = new Map<AssetClass, number>();
  for (const p of positions) {
    byAssetClassMap.set(p.assetClass, (byAssetClassMap.get(p.assetClass) ?? 0) + p.value);
  }
  const byAssetClass: ExposureByAssetClass[] = Array.from(byAssetClassMap.entries())
    .map(([assetClass, valueDollar]) => ({
      assetClass,
      valueDollar: Number(valueDollar.toFixed(2)),
      pctOfDeployed: deployedValue > 0 ? Number(((valueDollar / deployedValue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.valueDollar - a.valueDollar);

  return {
    totalEquity: Number(totalEquity.toFixed(2)),
    cashBalance: Number(cashBalance.toFixed(2)),
    deployedValue: Number(deployedValue.toFixed(2)),
    cashPct: totalEquity > 0 ? Number(((cashBalance / totalEquity) * 100).toFixed(1)) : 0,
    deployedPct: totalEquity > 0 ? Number(((deployedValue / totalEquity) * 100).toFixed(1)) : 0,
    openPositionCount: trades.length,
    largestPositionPct,
    concentrationHHI,
    byAssetClass,
  };
}
