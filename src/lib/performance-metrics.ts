// Stage 3 (Performance Analytics) — core risk-adjusted metrics. This is
// the single most important gap this platform has had: no page anywhere
// has ever been able to answer "is this system actually better than
// randomly investing in the market?" (TECHNICAL_DEBT.md TD-12). Every
// formula here is a standard, textbook definition — documented explicitly
// so the specific convention used is never ambiguous, and every one is
// unit-tested against a hand-computed expected value (see
// __tests__/performance-metrics.test.ts), not just "does it run."
//
// This is the FIRST slice of the full Stage 3 list (Sharpe, Sortino, max
// drawdown, profit factor, expectancy, win rate with CI, avg win/loss).
// Alpha/Beta/correlation-to-SPY, rolling metrics, and the four attribution
// categories (portfolio/signal/Claude/learning) are real, separate pieces
// of work not yet started — see ROADMAP.md for how this is sequenced.

import { computeCorrelation } from "@/lib/indicators";

export type TradeReturn = {
  pnlPct: number; // percentage return for this trade, e.g. 2.5 means +2.5%
  closedAt: string; // ISO timestamp
};

// ── Sharpe Ratio ──────────────────────────────────────────────────────────

export type SharpeResult = {
  raw: number; // unannualized — mean excess return / stdev of returns
  annualized: number | null; // raw * sqrt(observed trades per year), null if too few trades to estimate a frequency
  sampleSize: number;
};

/**
 * Sharpe Ratio = (mean return - risk-free rate) / standard deviation of
 * returns. Uses POPULATION standard deviation (dividing by N, not N-1) —
 * the standard convention for Sharpe when treating the observed trade
 * history as the complete population of interest rather than a sample
 * estimating a larger population, consistent with how this metric is
 * conventionally reported in trading contexts.
 *
 * Annualization: this system's returns are PER-TRADE, not per-day, so the
 * standard "multiply by sqrt(252)" daily convention doesn't apply. Instead,
 * the observed trade frequency (trades per year, derived from the actual
 * date range of the provided trades) is used — computed from the data
 * itself, not assumed. Returns null for the annualized figure when there
 * are too few trades or too short a date range to estimate a frequency
 * meaningfully (fewer than 2 trades, or all trades on the same timestamp).
 */
/**
 * Population mean and standard deviation of a set of returns. Shared by
 * computeSharpeRatio and computeVolatility (added later in this file) so
 * this calculation has a single source of truth rather than being
 * duplicated — the same DRY instinct applied elsewhere in this project
 * (shared instrument lists, shared auth utilities) after finding real
 * bugs caused by near-duplicate logic drifting apart.
 */
function computeMeanAndStdDev(returns: number[]): { mean: number; stdDev: number } {
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

export function computeSharpeRatio(trades: TradeReturn[], riskFreeRatePct = 0): SharpeResult | null {
  if (trades.length < 2) return null;
  const returns = trades.map((t) => t.pnlPct);
  const { mean, stdDev: std } = computeMeanAndStdDev(returns);
  if (std === 0) return null; // undefined — no variance to divide by

  const raw = (mean - riskFreeRatePct) / std;

  const sorted = [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
  const spanMs = new Date(sorted[sorted.length - 1].closedAt).getTime() - new Date(sorted[0].closedAt).getTime();
  const spanDays = spanMs / 86_400_000;
  let annualized: number | null = null;
  if (spanDays > 0) {
    const tradesPerYear = (trades.length / spanDays) * 365;
    annualized = raw * Math.sqrt(tradesPerYear);
  }

  return { raw: Number(raw.toFixed(4)), annualized: annualized != null ? Number(annualized.toFixed(4)) : null, sampleSize: trades.length };
}

// ── Sortino Ratio ─────────────────────────────────────────────────────────

/**
 * Sortino Ratio = (mean return - target) / downside deviation, where
 * downside deviation only penalizes returns BELOW the target (default 0%),
 * unlike Sharpe's standard deviation which penalizes upside volatility
 * equally. Uses the standard Sortino (1994) convention: the downside
 * deviation sum divides by the TOTAL sample size N (not just the count of
 * downside observations), treating any return at or above target as
 * contributing zero to the downside sum rather than being excluded outright.
 */
export function computeSortinoRatio(trades: TradeReturn[], targetPct = 0): number | null {
  if (trades.length < 2) return null;
  const returns = trades.map((t) => t.pnlPct);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const downsideSumSq = returns.reduce((s, r) => s + Math.min(0, r - targetPct) ** 2, 0);
  const downsideDeviation = Math.sqrt(downsideSumSq / returns.length);
  if (downsideDeviation === 0) return null; // no downside observed — undefined, not infinite
  return Number(((mean - targetPct) / downsideDeviation).toFixed(4));
}

// ── Maximum Drawdown ──────────────────────────────────────────────────────

export type DrawdownResult = {
  maxDrawdownPct: number; // positive number, e.g. 25 means a 25% peak-to-trough decline
  peakIndex: number;
  troughIndex: number;
};

/**
 * Maximum drawdown from an equity curve (chronologically ordered values).
 * Standard running-peak algorithm: track the highest value seen so far,
 * compute the decline from that peak at every subsequent point, report the
 * largest such decline. O(n), single pass.
 */
export function computeMaxDrawdown(equityCurve: number[]): DrawdownResult | null {
  if (equityCurve.length < 2) return null;
  let peak = equityCurve[0];
  let peakIndex = 0;
  let maxDrawdownPct = 0;
  let maxPeakIndex = 0;
  let maxTroughIndex = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      peakIndex = i;
    }
    if (peak > 0) {
      const drawdownPct = ((peak - equityCurve[i]) / peak) * 100;
      if (drawdownPct > maxDrawdownPct) {
        maxDrawdownPct = drawdownPct;
        maxPeakIndex = peakIndex;
        maxTroughIndex = i;
      }
    }
  }

  return { maxDrawdownPct: Number(maxDrawdownPct.toFixed(3)), peakIndex: maxPeakIndex, troughIndex: maxTroughIndex };
}

/**
 * Builds a synthetic realized-P&L equity curve from a chronological trade
 * sequence, starting at a base value and compounding each trade's % return
 * in sequence. This is a simplification worth being explicit about: it
 * reflects only REALIZED P&L at each trade's close, not true mark-to-market
 * equity (which would also move between trades as open positions'
 * unrealized P&L fluctuates). For a system where trades can overlap (which
 * this one's can — multiple positions open simultaneously), this curve
 * understates real intra-period volatility. Real portfolio equity snapshots
 * (already collected daily via the snapshot-portfolio cron) are the more
 * accurate source when available; this is the fallback/general-purpose
 * version for when only trade history is on hand.
 */
export function buildRealizedEquityCurve(trades: TradeReturn[], startingValue = 10_000): number[] {
  const sorted = [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
  const curve: number[] = [startingValue];
  let value = startingValue;
  for (const t of sorted) {
    value = value * (1 + t.pnlPct / 100);
    curve.push(value);
  }
  return curve;
}

// ── Profit Factor ─────────────────────────────────────────────────────────

/**
 * Profit Factor = gross profit from winning trades / gross loss from
 * losing trades (absolute value). Returns null when there are no losing
 * trades (undefined — not infinite) or no trades at all, rather than
 * returning Infinity, which is easy to mishandle downstream (e.g. in a
 * UI that formats it as a plain number).
 */
export function computeProfitFactor(pnls: number[]): number | null {
  const grossWins = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const grossLosses = Math.abs(pnls.filter((p) => p < 0).reduce((s, p) => s + p, 0));
  if (grossLosses === 0) return null;
  return Number((grossWins / grossLosses).toFixed(3));
}

// ── Expectancy, average win/loss ─────────────────────────────────────────

export type ExpectancyResult = {
  expectancyPct: number; // mean return per trade — mathematically equal to winRate*avgWin - lossRate*avgLoss
  avgWinPct: number;
  avgLossPct: number; // positive magnitude
  winCount: number;
  lossCount: number;
};

export function computeExpectancy(trades: TradeReturn[]): ExpectancyResult | null {
  if (trades.length === 0) return null;
  const returns = trades.map((t) => t.pnlPct);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const expectancyPct = returns.reduce((s, r) => s + r, 0) / returns.length;
  const avgWinPct = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length) : 0;
  return {
    expectancyPct: Number(expectancyPct.toFixed(4)),
    avgWinPct: Number(avgWinPct.toFixed(4)),
    avgLossPct: Number(avgLossPct.toFixed(4)),
    winCount: wins.length,
    lossCount: losses.length,
  };
}

// ── Win rate with confidence interval ────────────────────────────────────

export type WinRateResult = {
  winRate: number; // 0-1
  ciLower: number; // 0-1, 95% Wilson score lower bound
  ciUpper: number; // 0-1, 95% Wilson score upper bound
  sampleSize: number;
};

/**
 * Win rate as a point estimate is misleading on its own — the whole reason
 * this function exists is the exact concern already documented in
 * HYPOTHESIS_LOG.md H4: a "68% win rate over 24 trades" can have a true
 * rate anywhere from roughly 47% to 82% at 95% confidence. Uses the Wilson
 * score interval (not the simpler but less accurate normal approximation),
 * which is well-behaved even at small sample sizes and near 0%/100% —
 * exactly the conditions this system's early signal history will actually
 * have.
 */
export function computeWinRateWithConfidenceInterval(wins: number, total: number): WinRateResult | null {
  if (total <= 0 || wins < 0 || wins > total) return null;
  const z = 1.96; // 95% confidence
  const n = total;
  const pHat = wins / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = pHat + z2 / (2 * n);
  const margin = z * Math.sqrt((pHat * (1 - pHat)) / n + z2 / (4 * n * n));
  const ciLower = (center - margin) / denominator;
  const ciUpper = (center + margin) / denominator;
  return {
    winRate: Number(pHat.toFixed(4)),
    ciLower: Number(Math.max(0, ciLower).toFixed(4)),
    ciUpper: Number(Math.min(1, ciUpper).toFixed(4)),
    sampleSize: total,
  };
}

// ── Beta and Alpha (benchmark comparison) ────────────────────────────────
// The actual "real benchmark comparison" TD-12 originally called for and
// the first slice deliberately deferred. Computed from REAL daily-aligned
// data (portfolio_snapshots vs SPY daily closes on matching dates) — see
// src/lib/benchmark-comparison.functions.ts for the data-fetching and
// date-alignment layer that feeds these pure functions. Kept as pure,
// independently-testable math here, consistent with every other metric
// in this module.

/**
 * Beta = Cov(portfolio returns, benchmark returns) / Var(benchmark returns).
 * Uses population covariance/variance (dividing by N), matching the
 * convention already used for Sharpe's standard deviation in this same
 * module. Beta > 1 means the portfolio has historically moved MORE than
 * the benchmark (amplified market exposure); Beta < 1 means less; Beta
 * near 0 means largely uncorrelated with the benchmark's moves.
 */
export function computeBeta(portfolioReturns: number[], benchmarkReturns: number[]): number | null {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return null;
  const p = portfolioReturns.slice(-n);
  const b = benchmarkReturns.slice(-n);
  const meanP = p.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (p[i] - meanP) * (b[i] - meanB);
    varB += (b[i] - meanB) ** 2;
  }
  cov /= n;
  varB /= n;
  if (varB === 0) return null;
  return Number((cov / varB).toFixed(4));
}

/**
 * Jensen's Alpha = portfolio mean return - [risk-free rate + Beta *
 * (benchmark mean return - risk-free rate)] — the excess return NOT
 * explained by the portfolio's market exposure (Beta) alone. A positive
 * Alpha means the strategy outperformed what its level of market exposure
 * would predict; a negative Alpha means it underperformed that prediction,
 * even if raw returns looked fine. Requires beta to already be computed
 * (via computeBeta) rather than recomputing it internally, since callers
 * that need both should only compute the covariance/variance pass once.
 */
export function computeAlpha(portfolioReturns: number[], benchmarkReturns: number[], beta: number, riskFreeRatePct = 0): number | null {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return null;
  const p = portfolioReturns.slice(-n);
  const b = benchmarkReturns.slice(-n);
  const meanP = p.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  const expectedReturn = riskFreeRatePct + beta * (meanB - riskFreeRatePct);
  return Number((meanP - expectedReturn).toFixed(4));
}

/** Computes daily % returns from a chronologically-ordered series of values (equity or price). */
export function computeDailyReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) returns.push(((values[i] - values[i - 1]) / values[i - 1]) * 100);
  }
  return returns;
}

// ── Rolling Metrics ───────────────────────────────────────────────────────
// A single aggregate Sharpe/win-rate number can hide whether performance is
// actually improving or degrading — a strategy with a great overall Sharpe
// could still be in the middle of a recent decline that the aggregate
// figure smooths over. Rolling metrics show the trend, not just the
// endpoint. Deliberately reuses computeSharpeRatio/computeSortinoRatio
// directly (imported implicitly via being in the same module) rather than
// re-deriving the formulas — one tested implementation, applied to sliding
// windows instead of the whole history.

export type RollingMetricPoint = {
  /** Index of the last trade included in this window, in chronological order. */
  index: number;
  /** closedAt of the last trade in this window — when this window's figures became true. */
  date: string;
  rollingSharpe: number | null;
  rollingSortino: number | null;
  rollingWinRate: number | null; // 0-1
  windowSize: number;
};

/**
 * Computes Sharpe, Sortino, and win rate over a trailing window of the
 * most recent `windowSize` trades, advancing one trade at a time through
 * the full chronologically-sorted history. Returns one point per window
 * position once enough trades exist to fill a window — e.g. with
 * windowSize=20 and 25 total trades, this returns 6 points (windows ending
 * at trades 20 through 25).
 */
export function computeRollingMetrics(trades: TradeReturn[], windowSize: number): RollingMetricPoint[] {
  if (windowSize < 2 || trades.length < windowSize) return [];
  const sorted = [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
  const points: RollingMetricPoint[] = [];

  for (let i = windowSize - 1; i < sorted.length; i++) {
    const window = sorted.slice(i - windowSize + 1, i + 1);
    const sharpeResult = computeSharpeRatio(window);
    const sortinoResult = computeSortinoRatio(window);
    const wins = window.filter((t) => t.pnlPct > 0).length;

    points.push({
      index: i,
      date: sorted[i].closedAt,
      rollingSharpe: sharpeResult?.raw ?? null,
      rollingSortino: sortinoResult,
      rollingWinRate: Number((wins / window.length).toFixed(4)),
      windowSize,
    });
  }

  return points;
}

/**
 * Compares the most recent rolling window against the one immediately
 * before it, to answer the trend question directly: is the strategy
 * improving or deteriorating right now, not just "what's the Sharpe been
 * historically." Returns null when there aren't at least 2 rolling points
 * to compare.
 */
export function computeRollingTrend(points: RollingMetricPoint[]): { sharpeDelta: number | null; winRateDelta: number | null } | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  return {
    sharpeDelta: (latest.rollingSharpe != null && previous.rollingSharpe != null)
      ? Number((latest.rollingSharpe - previous.rollingSharpe).toFixed(4)) : null,
    winRateDelta: (latest.rollingWinRate != null && previous.rollingWinRate != null)
      ? Number((latest.rollingWinRate - previous.rollingWinRate).toFixed(4)) : null,
  };
}

// ── Trade Distribution ────────────────────────────────────────────────────
// Two histograms: how trade RETURNS are distributed (do results cluster in
// a tight band, or are there fat tails driving the aggregate numbers?) and
// how HOLDING TIME is distributed (is this actually a scalp-dominated
// system, or do positions linger far longer than intended?). Both use
// fixed, documented bucket boundaries rather than dynamically-computed
// bins, specifically so results are comparable across different report
// runs and different users — a histogram with data-dependent bin edges
// can't be compared meaningfully over time.

export type DistributionBucket = {
  label: string;
  count: number;
  pctOfTotal: number;
};

const RETURN_BUCKET_BOUNDARIES = [-10, -5, -2, 0, 2, 5, 10]; // percent — defines 8 buckets total

/**
 * Buckets trade returns into fixed ranges: <-10%, -10 to -5%, -5 to -2%,
 * -2 to 0%, 0 to 2%, 2 to 5%, 5 to 10%, >10%. A boundary value itself
 * (e.g. exactly -5%) falls into the LOWER bucket (i.e. the "-10 to -5%"
 * bucket, not "-5 to -2%") — buckets are defined as (lower, upper], using
 * `<=` against each ascending boundary in turn.
 */
export function computeReturnDistribution(trades: TradeReturn[]): DistributionBucket[] {
  if (trades.length === 0) return [];
  const labels = ["< -10%", "-10% to -5%", "-5% to -2%", "-2% to 0%", "0% to 2%", "2% to 5%", "5% to 10%", "> 10%"];
  const counts = new Array(labels.length).fill(0);

  for (const t of trades) {
    let bucketIndex = RETURN_BUCKET_BOUNDARIES.length; // default: last bucket (> largest boundary)
    for (let i = 0; i < RETURN_BUCKET_BOUNDARIES.length; i++) {
      if (t.pnlPct <= RETURN_BUCKET_BOUNDARIES[i]) { bucketIndex = i; break; }
    }
    counts[bucketIndex]++;
  }

  return labels.map((label, i) => ({
    label, count: counts[i], pctOfTotal: Number(((counts[i] / trades.length) * 100).toFixed(1)),
  }));
}

export type HoldingTimeInput = { createdAt: string; closedAt: string };

const HOLDING_TIME_BUCKET_BOUNDARIES_HOURS = [1, 4, 24, 72, 168]; // 1hr, 4hr, 1 day, 3 days, 7 days

/**
 * Buckets holding time (closedAt - createdAt) into fixed ranges: <1hr,
 * 1-4hr, 4-24hr, 1-3 days, 3-7 days, >7 days. Same boundary convention as
 * computeReturnDistribution — a trade held for EXACTLY 24 hours falls into
 * the "4-24hr" bucket, not "1-3 days".
 */
export function computeHoldingTimeDistribution(trades: HoldingTimeInput[]): DistributionBucket[] {
  if (trades.length === 0) return [];
  const labels = ["< 1 hour", "1-4 hours", "4-24 hours", "1-3 days", "3-7 days", "> 7 days"];
  const counts = new Array(labels.length).fill(0);

  for (const t of trades) {
    const hours = (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / 3_600_000;
    let bucketIndex = HOLDING_TIME_BUCKET_BOUNDARIES_HOURS.length;
    for (let i = 0; i < HOLDING_TIME_BUCKET_BOUNDARIES_HOURS.length; i++) {
      if (hours <= HOLDING_TIME_BUCKET_BOUNDARIES_HOURS[i]) { bucketIndex = i; break; }
    }
    counts[bucketIndex]++;
  }

  return labels.map((label, i) => ({
    label, count: counts[i], pctOfTotal: Number(((counts[i] / trades.length) * 100).toFixed(1)),
  }));
}

// ── Rolling Benchmark Metrics (rolling Beta/Alpha/Correlation) ───────────
// Extends the rolling-metrics infrastructure above to market exposure over
// time — the last item on the original Stage 3 list besides regime-
// conditional performance. A single aggregate Beta/Alpha (from
// benchmark-comparison.functions.ts) can hide the fact that market
// exposure has been drifting — a strategy that started market-neutral
// could have crept toward a much higher Beta without any single aggregate
// number showing it. Reuses computeBeta/computeAlpha/computeDailyReturns
// (defined above) and computeCorrelation (indicators.ts) directly, applied
// to sliding windows of the aligned portfolio/benchmark VALUE series
// (equity or price, not pre-computed returns) — correlation specifically
// needs the value series, not returns, since computeCorrelation derives
// returns internally.

export type RollingBenchmarkPoint = {
  /** Index into the aligned value series of the last point in this window. */
  index: number;
  rollingBeta: number | null;
  rollingAlpha: number | null;
  rollingCorrelation: number | null;
};

/**
 * Computes rolling Beta, Alpha, and correlation over a trailing window of
 * `windowSize` aligned (portfolio, benchmark) value points — e.g. daily
 * portfolio equity vs. daily SPY close, already date-aligned by the
 * caller (see benchmark-comparison.functions.ts's alignByDate). windowSize
 * counts VALUE points, not returns — a window of size N produces N-1
 * returns for the Beta/Alpha calculation inside it.
 *
 * NOTE on windowSize: computeCorrelation (indicators.ts) has its own
 * internal floor of >=10 value points before it will return a non-null
 * result — a windowSize below that will compute valid Beta/Alpha (which
 * have no such floor) but rollingCorrelation will silently be null for
 * every point. Callers should use windowSize >= 10 (20-30 is the more
 * typical convention for a rolling correlation window) to get all three
 * metrics populated.
 */
export function computeRollingBenchmarkMetrics(
  alignedPortfolioValues: number[],
  alignedBenchmarkValues: number[],
  windowSize: number,
): RollingBenchmarkPoint[] {
  const n = Math.min(alignedPortfolioValues.length, alignedBenchmarkValues.length);
  if (windowSize < 3 || n < windowSize) return []; // need >=3 values per window: >=2 returns for a meaningful Beta

  const points: RollingBenchmarkPoint[] = [];
  for (let i = windowSize - 1; i < n; i++) {
    const pValues = alignedPortfolioValues.slice(i - windowSize + 1, i + 1);
    const bValues = alignedBenchmarkValues.slice(i - windowSize + 1, i + 1);
    const pReturns = computeDailyReturns(pValues);
    const bReturns = computeDailyReturns(bValues);
    const beta = computeBeta(pReturns, bReturns);
    const alpha = beta != null ? computeAlpha(pReturns, bReturns, beta, 0) : null;
    const correlation = computeCorrelation(pValues, bValues, pValues.length);

    points.push({ index: i, rollingBeta: beta, rollingAlpha: alpha, rollingCorrelation: correlation });
  }

  return points;
}

// ── Regime-Conditional Performance ────────────────────────────────────────
// The last item of the original Stage 3 list. Answers: does this system
// actually perform differently in bull vs. bear vs. sideways markets, or
// is the aggregate expectancy hiding a strategy that only works in one
// regime? This is a pure aggregation function — the harder, more
// interesting part is retroactively reconstructing what the regime WAS at
// each trade's entry date, which lives in regime-performance.functions.ts
// since it requires fetching historical SPY data and re-running
// detectMarketRegime (indicators.ts) against a date-sliced view of it, the
// SAME live algorithm the system actually uses, applied retroactively —
// not a new or different regime-classification scheme.

export type TradeWithRegime = { pnlPct: number; regime: "bull" | "bear" | "sideways" };

export type RegimePerformanceRow = {
  regime: "bull" | "bear" | "sideways";
  tradeCount: number;
  avgReturnPct: number;
  winRate: number;
  /**
   * True once this regime has at least MIN_REGIME_SAMPLE trades. Found
   * during the Stage 3.5 skeptical review: unlike every other Stage 3
   * panel (Claude/Learning Attribution gate at 30, Signal Contribution
   * gates at 10), this function originally had NO minimum-evidence flag —
   * a regime bucket with 2 trades was displayed with the same visual
   * weight as one with 200. Fixed here rather than just noted, consistent
   * with "never present a metric with more confidence than its sample
   * size supports" (see PerformanceMetricsPanel's MetricCard).
   */
  hasMinimumEvidence: boolean;
};

const MIN_REGIME_SAMPLE = 10;

export function computeRegimePerformance(trades: TradeWithRegime[]): RegimePerformanceRow[] {
  if (trades.length === 0) return [];
  const byRegime = new Map<string, { sum: number; count: number; wins: number }>();
  for (const t of trades) {
    const existing = byRegime.get(t.regime) ?? { sum: 0, count: 0, wins: 0 };
    existing.sum += t.pnlPct;
    existing.count += 1;
    if (t.pnlPct > 0) existing.wins += 1;
    byRegime.set(t.regime, existing);
  }
  return Array.from(byRegime.entries())
    .map(([regime, stats]) => ({
      regime: regime as "bull" | "bear" | "sideways",
      tradeCount: stats.count,
      avgReturnPct: Number((stats.sum / stats.count).toFixed(3)),
      winRate: Number((stats.wins / stats.count).toFixed(4)),
      hasMinimumEvidence: stats.count >= MIN_REGIME_SAMPLE,
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount);
}

// ── Volatility (standalone) ───────────────────────────────────────────────
// Item 13b (TECHNICAL_DEBT.md TD-12 correction, 2026-08-06): standard
// deviation of returns already exists INTERNALLY inside the Sharpe/Sortino
// math above, but was never surfaced as its own reported number anywhere.
// Reuses computeMeanAndStdDev directly — same population-stdev definition
// Sharpe uses, not a second, differently-defined "volatility."

export type VolatilityResult = {
  /** Population standard deviation of per-trade returns, in percentage points. */
  stdDevPct: number;
  /** Same annualization convention as computeSharpeRatio (sqrt(tradesPerYear) scaling) — null if the trade span can't be determined. */
  annualizedStdDevPct: number | null;
  sampleSize: number;
};

export function computeVolatility(trades: TradeReturn[]): VolatilityResult | null {
  if (trades.length < 2) return null;
  const returns = trades.map((t) => t.pnlPct);
  const { stdDev } = computeMeanAndStdDev(returns);

  const sorted = [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
  const spanMs = new Date(sorted[sorted.length - 1].closedAt).getTime() - new Date(sorted[0].closedAt).getTime();
  const spanDays = spanMs / 86_400_000;
  let annualizedStdDevPct: number | null = null;
  if (spanDays > 0) {
    const tradesPerYear = (trades.length / spanDays) * 365;
    annualizedStdDevPct = stdDev * Math.sqrt(tradesPerYear);
  }

  return {
    stdDevPct: Number(stdDev.toFixed(4)),
    annualizedStdDevPct: annualizedStdDevPct != null ? Number(annualizedStdDevPct.toFixed(4)) : null,
    sampleSize: trades.length,
  };
}

// ── Average R ────────────────────────────────────────────────────────────
// Item 13b: return normalized by initial risk taken (the standard trading
// "R-multiple" concept), not raw percentage return. R = pnlPct / stopLossPct
// — since both are already percentage-of-entry-price measures, entry price
// cancels out and this holds regardless of direction, AS LONG AS pnlPct is
// correctly signed (positive = win) and stopLossPct is a positive distance,
// which is how this system already stores it. A trade with no recorded
// stop loss can't be normalized this way and is excluded, not defaulted to
// zero or dropped silently — the exclusion count is reported explicitly.

export type TradeWithRisk = { pnlPct: number; stopLossPct: number | null };

export type AverageRResult = {
  averageR: number | null;
  sampleSize: number;
  /** Trades excluded because they had no recorded stop loss (or a non-positive one) — reported explicitly, not silently dropped. */
  excludedNoStopLoss: number;
};

export function computeAverageR(trades: TradeWithRisk[]): AverageRResult {
  const valid = trades.filter((t) => t.stopLossPct != null && t.stopLossPct > 0);
  const excludedNoStopLoss = trades.length - valid.length;
  if (valid.length === 0) return { averageR: null, sampleSize: 0, excludedNoStopLoss };

  const rValues = valid.map((t) => t.pnlPct / t.stopLossPct!);
  const averageR = rValues.reduce((s, r) => s + r, 0) / rValues.length;
  return { averageR: Number(averageR.toFixed(3)), sampleSize: valid.length, excludedNoStopLoss };
}

// ── Risk Attribution ────────────────────────────────────────────────────
// Item 13b: the 5th of the originally-requested attribution categories
// (Portfolio/Signal/Claude/Learning were built in Stage 3; this one wasn't).
// Answers a genuinely different question than Portfolio Attribution: not
// "which symbols made the most money" but "which symbols are the most
// VOLATILE/unstable contributors" — measured as the population standard
// deviation of each symbol's own returns. True max-drawdown attribution
// would require decomposing a sequence-dependent, path-dependent portfolio
// statistic across symbols, which doesn't have a single canonical
// definition — this per-symbol return-variance measure is the tractable,
// well-defined interpretation of "risk attribution," stated as such rather
// than implied to be a full drawdown decomposition.

export type RiskAttributionRow = {
  symbol: string;
  tradeCount: number;
  /** Population std dev of this symbol's own trade returns — null if fewer than 2 trades (no variance is computable from a single point). */
  returnStdDevPct: number | null;
  avgReturnPct: number;
};

export function computeRiskAttribution(trades: Array<{ symbol: string; pnlPct: number }>): RiskAttributionRow[] {
  const bySymbol = new Map<string, number[]>();
  for (const t of trades) {
    const arr = bySymbol.get(t.symbol) ?? [];
    arr.push(t.pnlPct);
    bySymbol.set(t.symbol, arr);
  }

  return Array.from(bySymbol.entries())
    .map(([symbol, returns]) => {
      const avgReturnPct = returns.reduce((s, r) => s + r, 0) / returns.length;
      const returnStdDevPct = returns.length >= 2 ? computeMeanAndStdDev(returns).stdDev : null;
      return {
        symbol,
        tradeCount: returns.length,
        returnStdDevPct: returnStdDevPct != null ? Number(returnStdDevPct.toFixed(3)) : null,
        avgReturnPct: Number(avgReturnPct.toFixed(3)),
      };
    })
    .sort((a, b) => (b.returnStdDevPct ?? -1) - (a.returnStdDevPct ?? -1)); // riskiest (most volatile) first
}
