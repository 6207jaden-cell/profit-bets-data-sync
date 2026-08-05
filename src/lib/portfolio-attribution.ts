// Stage 3: Portfolio Attribution — the last of the four attribution
// categories. Answers a genuinely different question than the other three:
// not "which signal was involved" (Signal Attribution) or "did Claude/
// adaptive-learning add value" (Claude/Learning Attribution), but "which
// specific assets and asset classes is the P&L actually coming from."
//
// Unlike Signal Attribution — where a trade can have multiple signals
// active simultaneously, so percentages deliberately sum to more than
// 100% — every trade has exactly ONE symbol and ONE asset class. This is
// a true partition: percentages here sum to exactly 100% (modulo
// rounding), a useful contrast worth stating explicitly given how much
// the Signal Attribution documentation had to explain the opposite case.

type SupabaseAdminClient = any; // same documented pattern as signal-learning.ts / shadow-experiments.ts

export type AssetClass = "stock" | "etf" | "crypto" | "options" | "other";

export type AttributionBySymbol = {
  symbol: string;
  totalPnlDollar: number;
  tradeCount: number;
  pctOfTotalPnl: number | null;
};

export type AttributionByAssetClass = {
  assetClass: AssetClass;
  totalPnlDollar: number;
  tradeCount: number;
  pctOfTotalPnl: number | null;
};

export type PortfolioAttributionResult = {
  bySymbol: AttributionBySymbol[];
  byAssetClass: AttributionByAssetClass[];
  totalPnlDollar: number;
  tradeCount: number;
};

function classifyAssetClass(instrument: string | null | undefined): AssetClass {
  const i = String(instrument ?? "stock").toLowerCase();
  if (i === "stock") return "stock";
  if (i === "etf") return "etf";
  if (i === "crypto") return "crypto";
  if (["call", "put", "call_spread", "put_spread", "iron_condor"].includes(i)) return "options";
  return "other";
}

/**
 * Decomposes total realized P&L by symbol and by asset class. Reads
 * dollar P&L directly from closed paper_trades, same data source as
 * Signal Attribution, for consistency (both should always sum to the
 * exact same total).
 */
export async function computePortfolioAttribution(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
): Promise<PortfolioAttributionResult> {
  const { data } = await supabaseAdmin
    .from("paper_trades")
    .select("pnl, asset, instrument")
    .eq("user_id", userId)
    .eq("is_open", false)
    .not("pnl", "is", null);

  const trades = (data ?? []) as Array<{ pnl: number | string; asset: string; instrument: string | null }>;
  const totalPnlDollar = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0);

  const bySymbolMap = new Map<string, { totalPnl: number; count: number }>();
  const byAssetClassMap = new Map<AssetClass, { totalPnl: number; count: number }>();

  for (const t of trades) {
    const pnl = Number(t.pnl ?? 0);
    const symbol = String(t.asset ?? "UNKNOWN").toUpperCase();
    const assetClass = classifyAssetClass(t.instrument);

    const symStats = bySymbolMap.get(symbol) ?? { totalPnl: 0, count: 0 };
    symStats.totalPnl += pnl;
    symStats.count += 1;
    bySymbolMap.set(symbol, symStats);

    const classStats = byAssetClassMap.get(assetClass) ?? { totalPnl: 0, count: 0 };
    classStats.totalPnl += pnl;
    classStats.count += 1;
    byAssetClassMap.set(assetClass, classStats);
  }

  const pct = (val: number): number | null => totalPnlDollar !== 0 ? Number(((val / totalPnlDollar) * 100).toFixed(1)) : null;

  const bySymbol: AttributionBySymbol[] = Array.from(bySymbolMap.entries())
    .map(([symbol, stats]) => ({
      symbol, totalPnlDollar: Number(stats.totalPnl.toFixed(2)), tradeCount: stats.count, pctOfTotalPnl: pct(stats.totalPnl),
    }))
    .sort((a, b) => b.totalPnlDollar - a.totalPnlDollar);

  const byAssetClass: AttributionByAssetClass[] = Array.from(byAssetClassMap.entries())
    .map(([assetClass, stats]) => ({
      assetClass, totalPnlDollar: Number(stats.totalPnl.toFixed(2)), tradeCount: stats.count, pctOfTotalPnl: pct(stats.totalPnl),
    }))
    .sort((a, b) => b.totalPnlDollar - a.totalPnlDollar);

  return { bySymbol, byAssetClass, totalPnlDollar: Number(totalPnlDollar.toFixed(2)), tradeCount: trades.length };
}
