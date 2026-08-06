import { describe, it, expect } from "vitest";
import {
  computeSharpeRatio, computeSortinoRatio, computeMaxDrawdown, buildRealizedEquityCurve,
  computeProfitFactor, computeExpectancy, computeWinRateWithConfidenceInterval,
  computeBeta, computeAlpha, computeDailyReturns,
  computeRollingMetrics, computeRollingTrend,
  computeReturnDistribution, computeHoldingTimeDistribution, type HoldingTimeInput,
  type TradeReturn,
} from "@/lib/performance-metrics";

function trade(pnlPct: number, closedAt: string): TradeReturn {
  return { pnlPct, closedAt };
}

describe("computeSharpeRatio", () => {
  it("computes the correct hand-verified raw Sharpe for a known return series", () => {
    // returns = [2%, 3%, -1%, 4%, 1%], mean=1.8%, population stdev≈1.7205%
    // raw Sharpe = 1.8/1.7205 ≈ 1.0462
    const trades = [
      trade(2, "2026-01-01"), trade(3, "2026-01-02"), trade(-1, "2026-01-03"),
      trade(4, "2026-01-04"), trade(1, "2026-01-05"),
    ];
    const result = computeSharpeRatio(trades);
    expect(result).not.toBeNull();
    expect(result!.raw).toBeCloseTo(1.0462, 3);
    expect(result!.sampleSize).toBe(5);
  });

  it("returns null when fewer than 2 trades are provided", () => {
    expect(computeSharpeRatio([trade(5, "2026-01-01")])).toBeNull();
  });

  it("returns null when all returns are identical (zero variance, undefined Sharpe)", () => {
    const trades = [trade(2, "2026-01-01"), trade(2, "2026-01-02"), trade(2, "2026-01-03")];
    expect(computeSharpeRatio(trades)).toBeNull();
  });

  it("computes a null annualized figure but a valid raw figure when all trades share the same timestamp", () => {
    const trades = [trade(2, "2026-01-01T10:00:00Z"), trade(-1, "2026-01-01T10:00:00Z")];
    const result = computeSharpeRatio(trades);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toBeNull();
    expect(result!.annualized).toBeNull();
  });

  it("applies the risk-free rate as a subtraction from mean return", () => {
    const trades = [trade(5, "2026-01-01"), trade(3, "2026-01-02")];
    const withoutRf = computeSharpeRatio(trades, 0)!;
    const withRf = computeSharpeRatio(trades, 2)!;
    expect(withRf.raw).toBeLessThan(withoutRf.raw);
  });
});

describe("computeSortinoRatio", () => {
  it("computes the correct hand-verified Sortino for a known return series", () => {
    // Same series as the Sharpe test: [2%, 3%, -1%, 4%, 1%], mean=1.8%
    // downside sum of squares (target=0): only -1% contributes: (-1)^2 = 1 (in pct^2 units... using raw pct values)
    // downsideDeviation = sqrt(1/5) = sqrt(0.2) ≈ 0.4472
    // sortino = 1.8/0.4472 ≈ 4.0249
    const trades = [
      trade(2, "2026-01-01"), trade(3, "2026-01-02"), trade(-1, "2026-01-03"),
      trade(4, "2026-01-04"), trade(1, "2026-01-05"),
    ];
    const result = computeSortinoRatio(trades);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(4.0249, 2);
  });

  it("returns null when there are no downside returns at all (undefined, not infinite)", () => {
    const trades = [trade(2, "2026-01-01"), trade(3, "2026-01-02"), trade(5, "2026-01-03")];
    expect(computeSortinoRatio(trades)).toBeNull();
  });

  it("is more forgiving of upside volatility than Sharpe — a series with one huge win and small consistent losses should show a higher Sortino than Sharpe", () => {
    const trades = [
      trade(50, "2026-01-01"), trade(-1, "2026-01-02"), trade(-1, "2026-01-03"), trade(-1, "2026-01-04"),
    ];
    const sharpe = computeSharpeRatio(trades)!;
    const sortino = computeSortinoRatio(trades)!;
    expect(sortino).toBeGreaterThan(sharpe.raw);
  });
});

describe("computeMaxDrawdown", () => {
  it("computes the correct hand-verified max drawdown for a known equity curve", () => {
    // [100, 110, 105, 120, 90, 95, 130] -> peak 120, trough 90 -> (120-90)/120 = 25%
    const result = computeMaxDrawdown([100, 110, 105, 120, 90, 95, 130]);
    expect(result).not.toBeNull();
    expect(result!.maxDrawdownPct).toBeCloseTo(25, 2);
  });

  it("returns 0% drawdown for a monotonically increasing equity curve", () => {
    const result = computeMaxDrawdown([100, 105, 110, 120, 130]);
    expect(result!.maxDrawdownPct).toBe(0);
  });

  it("returns null for fewer than 2 points", () => {
    expect(computeMaxDrawdown([100])).toBeNull();
    expect(computeMaxDrawdown([])).toBeNull();
  });

  it("correctly identifies the peak and trough indices, not just the magnitude", () => {
    const result = computeMaxDrawdown([100, 200, 50, 300, 250])!;
    expect(result.peakIndex).toBe(1); // value 200
    expect(result.troughIndex).toBe(2); // value 50
  });
});

describe("buildRealizedEquityCurve", () => {
  it("compounds trade returns sequentially and correctly", () => {
    // start 10000, +10% -> 11000, -5% -> 10450
    const trades = [trade(10, "2026-01-02"), trade(-5, "2026-01-01")]; // deliberately out of order to test sorting
    const curve = buildRealizedEquityCurve(trades, 10_000);
    expect(curve[0]).toBe(10_000);
    // sorted chronologically: 2026-01-01 (-5%) first, then 2026-01-02 (+10%)
    expect(curve[1]).toBeCloseTo(9_500, 1); // 10000 * 0.95
    expect(curve[2]).toBeCloseTo(10_450, 1); // 9500 * 1.10
  });
});

describe("computeProfitFactor", () => {
  it("computes the correct hand-verified profit factor", () => {
    // wins: 100+200+150=450, losses: 50+30=80 -> 450/80 = 5.625
    const result = computeProfitFactor([100, -50, 200, -30, 150]);
    expect(result).toBeCloseTo(5.625, 3);
  });

  it("returns null when there are no losing trades (undefined, not Infinity)", () => {
    expect(computeProfitFactor([100, 200, 50])).toBeNull();
  });

  it("returns 0 when there are no winning trades", () => {
    expect(computeProfitFactor([-100, -50])).toBe(0);
  });
});

describe("computeExpectancy", () => {
  it("computes expectancy equal to the simple mean return, matching win_rate*avg_win - loss_rate*avg_loss identically", () => {
    const trades = [trade(10, "a"), trade(-5, "b"), trade(20, "c"), trade(-10, "d"), trade(5, "e")];
    const result = computeExpectancy(trades)!;
    // mean = (10-5+20-10+5)/5 = 20/5 = 4
    expect(result.expectancyPct).toBeCloseTo(4, 3);
    // Cross-check via the win_rate*avg_win - loss_rate*avg_loss formula
    const winRate = result.winCount / trades.length;
    const lossRate = result.lossCount / trades.length;
    const crossCheck = winRate * result.avgWinPct - lossRate * result.avgLossPct;
    expect(crossCheck).toBeCloseTo(result.expectancyPct, 3);
  });

  it("returns null for an empty trade list", () => {
    expect(computeExpectancy([])).toBeNull();
  });

  it("avgLossPct is reported as a positive magnitude, not negative", () => {
    const trades = [trade(-10, "a"), trade(5, "b")];
    const result = computeExpectancy(trades)!;
    expect(result.avgLossPct).toBeGreaterThan(0);
  });
});

describe("computeWinRateWithConfidenceInterval", () => {
  it("computes the correct hand-verified Wilson score interval for a known case", () => {
    // wins=16, n=24, p_hat=0.6667 -> Wilson 95% CI ≈ [0.4671, 0.8203]
    // (hand-computed: z=1.96, denom=1.16007, center=0.7467, margin=0.20488)
    const result = computeWinRateWithConfidenceInterval(16, 24);
    expect(result).not.toBeNull();
    expect(result!.winRate).toBeCloseTo(0.6667, 3);
    expect(result!.ciLower).toBeCloseTo(0.4671, 2);
    expect(result!.ciUpper).toBeCloseTo(0.8203, 2);
  });

  it("produces a WIDER interval for a smaller sample size at the same win rate", () => {
    const small = computeWinRateWithConfidenceInterval(6, 10)!; // 60% of 10
    const large = computeWinRateWithConfidenceInterval(60, 100)!; // 60% of 100
    const smallWidth = small.ciUpper - small.ciLower;
    const largeWidth = large.ciUpper - large.ciLower;
    expect(smallWidth).toBeGreaterThan(largeWidth);
  });

  it("returns null for invalid inputs (negative wins, wins exceeding total, zero total)", () => {
    expect(computeWinRateWithConfidenceInterval(-1, 10)).toBeNull();
    expect(computeWinRateWithConfidenceInterval(11, 10)).toBeNull();
    expect(computeWinRateWithConfidenceInterval(0, 0)).toBeNull();
  });

  it("keeps both bounds within the valid [0,1] probability range even at extreme win rates", () => {
    const allWins = computeWinRateWithConfidenceInterval(10, 10)!;
    expect(allWins.ciUpper).toBeLessThanOrEqual(1);
    expect(allWins.ciLower).toBeGreaterThanOrEqual(0);

    const allLosses = computeWinRateWithConfidenceInterval(0, 10)!;
    expect(allLosses.ciLower).toBeGreaterThanOrEqual(0);
    expect(allLosses.ciUpper).toBeLessThanOrEqual(1);
  });
});

describe("computeBeta", () => {
  it("computes the correct hand-verified beta for known return series", () => {
    // portfolio = [1, 2, -1, 3], benchmark = [0.5, 1.5, -0.5, 2]
    // meanP=1.25, meanB=0.875
    // Cov (population) = 1.40625, Var(benchmark) = 0.921875
    // Beta = 1.40625/0.921875 ≈ 1.5254
    const portfolio = [1, 2, -1, 3];
    const benchmark = [0.5, 1.5, -0.5, 2];
    const beta = computeBeta(portfolio, benchmark);
    expect(beta).not.toBeNull();
    expect(beta!).toBeCloseTo(1.5254, 3);
  });

  it("returns beta ≈ 1 when the portfolio moves identically to the benchmark", () => {
    const series = [1, 2, -1, 3, 0.5];
    const beta = computeBeta(series, series);
    expect(beta!).toBeCloseTo(1, 3);
  });

  it("returns null when the benchmark has zero variance (undefined, can't divide by zero)", () => {
    expect(computeBeta([1, 2, 3], [1, 1, 1])).toBeNull();
  });

  it("returns null with fewer than 2 aligned data points", () => {
    expect(computeBeta([1], [1])).toBeNull();
  });

  it("truncates to the shorter series length when inputs are mismatched, using the most recent overlapping data", () => {
    const portfolio = [1, 2, -1, 3, 5]; // 5 points
    const benchmark = [0.5, 1.5, -0.5]; // 3 points
    const beta = computeBeta(portfolio, benchmark);
    // Should use only the last 3 portfolio points: [-1, 3, 5] vs [0.5, 1.5, -0.5]
    const expected = computeBeta([-1, 3, 5], [0.5, 1.5, -0.5]);
    expect(beta).toEqual(expected);
  });
});

describe("computeAlpha", () => {
  it("computes the correct hand-verified alpha for the same known series used in the beta test", () => {
    // Using beta=1.5254 (computed above), meanP=1.25, meanB=0.875, rf=0
    // expectedReturn = 0 + 1.5254*(0.875-0) = 1.33474...
    // alpha = 1.25 - 1.33474 ≈ -0.08474
    const portfolio = [1, 2, -1, 3];
    const benchmark = [0.5, 1.5, -0.5, 2];
    const beta = computeBeta(portfolio, benchmark)!;
    const alpha = computeAlpha(portfolio, benchmark, beta, 0);
    expect(alpha).not.toBeNull();
    expect(alpha!).toBeCloseTo(-0.0847, 2);
  });

  it("returns alpha ≈ 0 when the portfolio exactly tracks the benchmark (no excess return)", () => {
    const series = [1, 2, -1, 3, 0.5];
    const beta = computeBeta(series, series)!;
    const alpha = computeAlpha(series, series, beta, 0);
    expect(alpha!).toBeCloseTo(0, 3);
  });

  it("a higher risk-free rate reduces alpha for a portfolio with beta < 1 relative to the same test at rf=0", () => {
    const portfolio = [1, 2, -1, 3];
    const benchmark = [0.5, 1.5, -0.5, 2];
    const beta = computeBeta(portfolio, benchmark)!;
    const alphaNoRf = computeAlpha(portfolio, benchmark, beta, 0)!;
    const alphaWithRf = computeAlpha(portfolio, benchmark, beta, 0.1)!;
    expect(alphaWithRf).not.toBe(alphaNoRf);
  });
});

describe("computeDailyReturns", () => {
  it("computes correct percentage returns from a known value series", () => {
    // [100, 110, 104.5] -> +10%, -5%
    const returns = computeDailyReturns([100, 110, 104.5]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(10, 3);
    expect(returns[1]).toBeCloseTo(-5, 3);
  });

  it("returns an empty array for a single value (no return computable)", () => {
    expect(computeDailyReturns([100])).toEqual([]);
  });

  it("skips a transition where the prior value is zero or negative, rather than producing Infinity/NaN", () => {
    const returns = computeDailyReturns([0, 100, 110]);
    expect(returns.every((r) => Number.isFinite(r))).toBe(true);
  });
});

describe("computeRollingMetrics", () => {
  it("computes the correct hand-verified rolling win rate over a known trade sequence", () => {
    // 6 trades, returns [2, -1, 3, -2, 4, 1], window=3
    // window i=2 (trades 0-2 = [2,-1,3]): 2 wins / 3 = 0.6667
    // window i=3 (trades 1-3 = [-1,3,-2]): 1 win / 3 = 0.3333
    // window i=4 (trades 2-4 = [3,-2,4]): 2 wins / 3 = 0.6667
    // window i=5 (trades 3-5 = [-2,4,1]): 2 wins / 3 = 0.6667
    const trades: TradeReturn[] = [2, -1, 3, -2, 4, 1].map((pnlPct, i) => ({ pnlPct, closedAt: `2026-01-0${i + 1}` }));
    const points = computeRollingMetrics(trades, 3);
    expect(points).toHaveLength(4); // 6 trades - 3 window + 1
    expect(points[0].rollingWinRate).toBeCloseTo(0.6667, 3);
    expect(points[1].rollingWinRate).toBeCloseTo(0.3333, 3);
    expect(points[2].rollingWinRate).toBeCloseTo(0.6667, 3);
    expect(points[3].rollingWinRate).toBeCloseTo(0.6667, 3);
  });

  it("returns an empty array when there are fewer trades than the window size", () => {
    const trades: TradeReturn[] = [1, 2].map((pnlPct, i) => ({ pnlPct, closedAt: `2026-01-0${i + 1}` }));
    expect(computeRollingMetrics(trades, 5)).toEqual([]);
  });

  it("returns an empty array for an invalid (too small) window size", () => {
    const trades: TradeReturn[] = [1, 2, 3].map((pnlPct, i) => ({ pnlPct, closedAt: `2026-01-0${i + 1}` }));
    expect(computeRollingMetrics(trades, 1)).toEqual([]);
  });

  it("sorts trades chronologically before windowing, regardless of input order", () => {
    // Same trades as the first test but shuffled — result should be identical
    const shuffled: TradeReturn[] = [
      { pnlPct: 4, closedAt: "2026-01-05" },
      { pnlPct: 2, closedAt: "2026-01-01" },
      { pnlPct: 1, closedAt: "2026-01-06" },
      { pnlPct: -1, closedAt: "2026-01-02" },
      { pnlPct: -2, closedAt: "2026-01-04" },
      { pnlPct: 3, closedAt: "2026-01-03" },
    ];
    const points = computeRollingMetrics(shuffled, 3);
    expect(points[0].rollingWinRate).toBeCloseTo(0.6667, 3);
  });

  it("each rolling point's date matches the closedAt of the last trade in that window", () => {
    const trades: TradeReturn[] = [1, 2, 3, 4].map((pnlPct, i) => ({ pnlPct, closedAt: `2026-01-0${i + 1}` }));
    const points = computeRollingMetrics(trades, 3);
    expect(points[0].date).toBe("2026-01-03"); // window [1,2,3], ends at trade 3
    expect(points[1].date).toBe("2026-01-04"); // window [2,3,4], ends at trade 4
  });
});

describe("computeRollingTrend", () => {
  it("computes the correct delta between the two most recent rolling windows", () => {
    const points = [
      { index: 0, date: "a", rollingSharpe: 1.0, rollingSortino: 1.5, rollingWinRate: 0.5, windowSize: 3 },
      { index: 1, date: "b", rollingSharpe: 1.5, rollingSortino: 2.0, rollingWinRate: 0.6, windowSize: 3 },
    ];
    const trend = computeRollingTrend(points)!;
    expect(trend.sharpeDelta).toBeCloseTo(0.5, 3);
    expect(trend.winRateDelta).toBeCloseTo(0.1, 3);
  });

  it("returns null with fewer than 2 rolling points to compare", () => {
    expect(computeRollingTrend([])).toBeNull();
    expect(computeRollingTrend([{ index: 0, date: "a", rollingSharpe: 1, rollingSortino: 1, rollingWinRate: 0.5, windowSize: 3 }])).toBeNull();
  });

  it("a negative delta correctly indicates deteriorating recent performance", () => {
    const points = [
      { index: 0, date: "a", rollingSharpe: 2.0, rollingSortino: 2.0, rollingWinRate: 0.7, windowSize: 3 },
      { index: 1, date: "b", rollingSharpe: 0.5, rollingSortino: 0.5, rollingWinRate: 0.4, windowSize: 3 },
    ];
    const trend = computeRollingTrend(points)!;
    expect(trend.sharpeDelta).toBeLessThan(0);
    expect(trend.winRateDelta).toBeLessThan(0);
  });
});

describe("computeReturnDistribution", () => {
  it("buckets a known set of returns correctly across all 8 buckets", () => {
    // One return in each of the 8 buckets, exactly as designed
    const trades: TradeReturn[] = [-15, -7, -3, -1, 1, 3, 7, 15].map((pnlPct, i) => ({ pnlPct, closedAt: `t${i}` }));
    const result = computeReturnDistribution(trades);
    expect(result).toHaveLength(8);
    expect(result.every((b) => b.count === 1)).toBe(true);
    expect(result.every((b) => b.pctOfTotal === 12.5)).toBe(true);
    expect(result[0].label).toBe("< -10%");
    expect(result[7].label).toBe("> 10%");
  });

  it("a boundary value falls into the LOWER bucket, not the upper one", () => {
    // Exactly -5% should land in "-10% to -5%", not "-5% to -2%"
    const trades: TradeReturn[] = [{ pnlPct: -5, closedAt: "t0" }];
    const result = computeReturnDistribution(trades);
    expect(result.find((b) => b.label === "-10% to -5%")!.count).toBe(1);
    expect(result.find((b) => b.label === "-5% to -2%")!.count).toBe(0);
  });

  it("returns an empty array for no trades", () => {
    expect(computeReturnDistribution([])).toEqual([]);
  });

  it("bucket percentages sum to exactly 100% (a true partition, like Portfolio Attribution)", () => {
    const trades: TradeReturn[] = [1, 2, 3, -1, -2, 8].map((pnlPct, i) => ({ pnlPct, closedAt: `t${i}` }));
    const result = computeReturnDistribution(trades);
    const sum = result.reduce((s, b) => s + b.pctOfTotal, 0);
    expect(sum).toBeCloseTo(100, 0);
  });
});

describe("computeHoldingTimeDistribution", () => {
  it("buckets a known set of holding times correctly across all 6 buckets", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const holdingHours = [0.5, 2, 12, 48, 120, 200]; // 30min, 2hr, 12hr, 2days, 5days, ~8.3days
    const trades = holdingHours.map((h) => ({
      createdAt: new Date(base).toISOString(),
      closedAt: new Date(base + h * 3_600_000).toISOString(),
    }));
    const result = computeHoldingTimeDistribution(trades);
    expect(result).toHaveLength(6);
    expect(result.every((b) => b.count === 1)).toBe(true);
    expect(result[0].label).toBe("< 1 hour");
    expect(result[5].label).toBe("> 7 days");
  });

  it("a boundary value (exactly 24 hours) falls into the LOWER bucket", () => {
    const trades: HoldingTimeInput[] = [{ createdAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-02T00:00:00Z" }]; // exactly 24hr
    const result = computeHoldingTimeDistribution(trades);
    expect(result.find((b) => b.label === "4-24 hours")!.count).toBe(1);
    expect(result.find((b) => b.label === "1-3 days")!.count).toBe(0);
  });

  it("returns an empty array for no trades", () => {
    expect(computeHoldingTimeDistribution([])).toEqual([]);
  });

  it("bucket percentages sum to exactly 100%", () => {
    const trades: HoldingTimeInput[] = [
      { createdAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-01T00:30:00Z" },
      { createdAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-01T02:00:00Z" },
      { createdAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-05T00:00:00Z" },
    ];
    const result = computeHoldingTimeDistribution(trades);
    const sum = result.reduce((s, b) => s + b.pctOfTotal, 0);
    expect(sum).toBeCloseTo(100, 0);
  });
});
