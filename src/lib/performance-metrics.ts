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
export function computeSharpeRatio(trades: TradeReturn[], riskFreeRatePct = 0): SharpeResult | null {
  if (trades.length < 2) return null;
  const returns = trades.map((t) => t.pnlPct);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
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
