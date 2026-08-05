// Stage 3: real benchmark comparison — the actual "vs SPY" question
// TD-12 originally called for and the first performance-metrics slice
// deliberately deferred (see CHANGELOG.md). Uses REAL daily-aligned data:
// portfolio_snapshots (already collected daily by the snapshot-portfolio
// cron) matched by date against SPY's own daily closes — not a synthetic
// trade-sequence approximation like buildRealizedEquityCurve uses for the
// other metrics, since Beta/Alpha specifically need genuine calendar-time
// alignment between the two series to mean anything.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchBars, computeCorrelation } from "@/lib/indicators";
import { computeBeta, computeAlpha, computeDailyReturns } from "@/lib/performance-metrics";

export type BenchmarkComparisonResult = {
  beta: number | null;
  alpha: number | null;
  correlationToSpy: number | null;
  sampleSize: number;
  insufficientData: boolean;
};

/**
 * Aligns two (date, value) series by calendar day (using the date portion
 * of each ISO timestamp, ignoring time-of-day) and returns only the dates
 * present in BOTH series, in chronological order. This is the honest part
 * of the whole computation — portfolio snapshots and SPY bars are captured
 * at different times of day by different systems, so exact timestamp
 * matching would silently drop nearly everything; matching by calendar
 * date is the correct, standard way to align two independently-sourced
 * daily series.
 */
function alignByDate(
  seriesA: Array<{ date: string; value: number }>,
  seriesB: Array<{ date: string; value: number }>,
): { a: number[]; b: number[] } {
  const mapB = new Map(seriesB.map((p) => [p.date, p.value]));
  const a: number[] = [];
  const b: number[] = [];
  for (const point of seriesA) {
    const bVal = mapB.get(point.date);
    if (bVal != null) {
      a.push(point.value);
      b.push(bVal);
    }
  }
  return { a, b };
}

export const getBenchmarkComparison = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BenchmarkComparisonResult> => {
    const empty: BenchmarkComparisonResult = { beta: null, alpha: null, correlationToSpy: null, sampleSize: 0, insufficientData: true };

    const { data: snapshots, error } = await context.supabase
      .from("portfolio_snapshots")
      .select("equity, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error || !snapshots || snapshots.length < 3) return empty; // need at least a few days to compute a meaningful daily-return series

    const portfolioSeries = snapshots
      .map((s: { equity: unknown; created_at: string }) => ({ date: String(s.created_at).slice(0, 10), value: Number(s.equity) }))
      .filter((p) => Number.isFinite(p.value) && p.value > 0);
    if (portfolioSeries.length < 3) return empty;

    // Fetch enough SPY history to cover the portfolio's own date range,
    // with headroom — fetchBars' `days` parameter is trading-day-ish, not
    // exact calendar days, so over-fetching a bit is deliberate and safe
    // (extra SPY dates outside the portfolio's range just won't align).
    const oldestSnapshotDate = new Date(portfolioSeries[0].date);
    const daysSinceOldest = Math.ceil((Date.now() - oldestSnapshotDate.getTime()) / 86_400_000);
    const spyBars = await fetchBars("SPY", Math.max(30, daysSinceOldest + 10));
    if (!spyBars || spyBars.closes.length < 3) return empty;

    const spySeries = spyBars.times.map((t, i) => ({ date: new Date(t).toISOString().slice(0, 10), value: spyBars.closes[i] }));

    const { a: alignedPortfolio, b: alignedSpy } = alignByDate(portfolioSeries, spySeries);
    if (alignedPortfolio.length < 3) return empty;

    const portfolioReturns = computeDailyReturns(alignedPortfolio);
    const spyReturns = computeDailyReturns(alignedSpy);
    if (portfolioReturns.length < 2) return empty;

    const beta = computeBeta(portfolioReturns, spyReturns);
    const alpha = beta != null ? computeAlpha(portfolioReturns, spyReturns, beta, 0) : null;
    const correlationToSpy = computeCorrelation(alignedPortfolio, alignedSpy, alignedPortfolio.length);

    return {
      beta,
      alpha,
      correlationToSpy,
      sampleSize: portfolioReturns.length,
      insufficientData: portfolioReturns.length < 20, // same 20-observation floor used elsewhere in this project for "don't trust this yet"
    };
  });
