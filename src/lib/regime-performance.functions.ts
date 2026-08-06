// Stage 3: Regime-Conditional Performance — the last item of the original
// Stage 3 list. Answers: does this system actually perform differently in
// bull vs. bear vs. sideways markets?
//
// DESIGN DECISION (worth being explicit about, since there were two real
// options here): this reconstructs each trade's regime RETROACTIVELY from
// historical SPY data, re-running the exact same detectMarketRegime
// (indicators.ts) algorithm the live system uses, rather than only
// recording regime going forward on new trades. The forward-only approach
// would be simpler but would produce zero results until a large volume of
// NEW trades accumulated — everything already in the trade history would
// be permanently unusable for this analysis. Retroactive reconstruction
// costs one broad SPY history fetch instead, and works on trade history
// that already exists today. The tradeoff: this assumes detectMarketRegime
// itself hasn't changed its definition of bull/bear/sideways since these
// trades were made — if that function's thresholds are ever revised, this
// analysis reflects the CURRENT definition applied historically, not
// necessarily what the live system actually believed at the time (which
// only matters if the function changes; as of this writing it hasn't).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchBars, detectMarketRegime, type Bars } from "@/lib/indicators";
import { computeRegimePerformance, type RegimePerformanceRow, type TradeWithRegime } from "@/lib/performance-metrics";

export type RegimePerformanceResult = {
  rows: RegimePerformanceRow[];
  totalTradeCount: number;
};

/**
 * Finds the regime as of `targetDate` by locating the last SPY bar at or
 * before that date and running detectMarketRegime on everything up to and
 * including it — exactly what the live system would have seen at that
 * point in time. Returns "sideways" (detectMarketRegime's own documented
 * fallback) when there isn't at least 200 days of SPY history before the
 * target date, matching that function's own internal floor rather than
 * inventing a different one here.
 */
function findRegimeAtDate(spyBars: Bars, targetDateIso: string): "bull" | "bear" | "sideways" {
  const targetMs = new Date(targetDateIso).getTime();
  let cutoffIndex = -1;
  for (let i = 0; i < spyBars.times.length; i++) {
    if (spyBars.times[i] <= targetMs) cutoffIndex = i;
    else break; // spyBars.times is chronologically ascending
  }
  if (cutoffIndex < 199) return "sideways"; // matches detectMarketRegime's own <200-days floor
  return detectMarketRegime(spyBars.closes.slice(0, cutoffIndex + 1));
}

export const getRegimePerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RegimePerformanceResult> => {
    const empty: RegimePerformanceResult = { rows: [], totalTradeCount: 0 };

    const { data: trades, error } = await context.supabase
      .from("paper_trades")
      .select("pnl, side, entry_price, exit_price, created_at")
      .eq("user_id", context.userId)
      .eq("is_open", false)
      .not("exit_price", "is", null)
      .order("created_at", { ascending: true });
    if (error || !trades || trades.length === 0) return empty;

    const validTrades = (trades as Array<{ pnl: number | null; side: string; entry_price: number; exit_price: number; created_at: string }>)
      .filter((t) => t.entry_price > 0);
    if (validTrades.length === 0) return empty;

    // Fetch ONE broad SPY history covering from 200 days before the
    // earliest trade (detectMarketRegime's own SMA200 requirement) through
    // today, rather than a separate fetch per trade.
    const earliestDate = new Date(validTrades[0].created_at);
    const daysSinceEarliest = Math.ceil((Date.now() - earliestDate.getTime()) / 86_400_000);
    const spyBars = await fetchBars("SPY", daysSinceEarliest + 210);
    if (!spyBars || spyBars.closes.length < 200) return empty;

    const tradesWithRegime: TradeWithRegime[] = validTrades.map((t) => {
      const dir = t.side === "buy" ? 1 : -1;
      const pnlPct = ((t.exit_price - t.entry_price) / t.entry_price) * 100 * dir;
      return { pnlPct, regime: findRegimeAtDate(spyBars, t.created_at) };
    });

    return { rows: computeRegimePerformance(tradesWithRegime), totalTradeCount: tradesWithRegime.length };
  });
