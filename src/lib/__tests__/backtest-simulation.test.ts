import { describe, it, expect } from "vitest";
import { simulateBacktestDay, lastValidSimulationDay, type SymBars } from "@/lib/backtest-simulation";

/**
 * Builds a symbol's bars where the first 49 closes are a constant 100,
 * making SMA50-at-index-49 hand-computable: (49*100 + closes[49]) / 50.
 */
function buildSymbol(symbol: string, close49: number, opens: number[], closesAfter49: number[]): SymBars {
  const closes = [...Array(49).fill(100), close49, ...closesAfter49];
  const fullOpens = [...Array(50).fill(100), ...opens];
  return { symbol, times: closes.map((_, i) => i), opens: fullOpens, closes };
}

describe("simulateBacktestDay", () => {
  it("computes the correct hand-verified entry/exit using NEXT-bar open (Finding 11) with slippage applied (Finding 13)", () => {
    // Symbol A: closes[0..48]=100 (49x), closes[49]=110.
    //   sma50 at day=49 = (49*100 + 110) / 50 = 5010/50 = 100.2
    //   momentum = (110 - 100.2) / 100.2 ≈ 0.09780
    // Symbol B: closes[0..48]=100 (49x), closes[49]=90.
    //   sma50 = (49*100 + 90) / 50 = 4990/50 = 99.8
    //   momentum = (90 - 99.8) / 99.8 ≈ -0.09820
    // A has higher momentum, so with picksPerDay=1, A is chosen, not B.
    //
    // Raw entry (before slippage): opens[day+1] = opens[50] = 100.
    // Raw exit (before slippage): closes[day+1+holdDays] = closes[52] = 110 (holdDays=2).
    // Symbol "A" is not a crypto symbol (isCryptoSymbol("A") is false) and
    // avgDailyVolume is passed as unknown — this lands in
    // estimateSlippageBps's "unknown liquidity, stock" tier: 5.5 bps,
    // confirmed by reading the real implementation directly (not assumed)
    // before writing this test.
    // entry (buy, +5.5bps) = 100 * 1.00055 = 100.055
    // exit (sell, -5.5bps) = 110 * 0.99945 = 109.9395
    // r = (109.9395 - 100.055) / 100.055 ≈ 0.098791 -> 9.8791%, slightly
    // BELOW the pre-slippage 10% — slippage should reduce reported
    // returns, never increase them, which this also confirms.
    const symbolA = buildSymbol("A", 110, [100], [105, 108, 110]); // opens[50]=100, closes[50..52]=105,108,110
    const symbolB = buildSymbol("B", 90, [95], [95, 95, 95]);
    const universe = [symbolA, symbolB];

    const result = simulateBacktestDay(universe, 49, 1, 2);
    expect(result).not.toBeNull();
    expect(result!.trades).toHaveLength(1);
    expect(result!.trades[0].symbol).toBe("A"); // higher momentum, correctly chosen
    expect(result!.trades[0].entry).toBeCloseTo(100.055, 3);
    expect(result!.trades[0].exit).toBeCloseTo(109.9395, 3);
    expect(result!.trades[0].pnl_pct).toBeCloseTo(9.8791, 2);
    expect(result!.dayPnlPct).toBeCloseTo(0.098791, 4);
  });

  it("slippage always makes the reported return worse than the raw, pre-slippage return — never better, in either direction", () => {
    const winningSymbol = buildSymbol("W", 110, [100], [105, 108, 120]); // raw return positive
    const losingSymbol = buildSymbol("L", 90, [100], [95, 92, 80]); // raw return negative
    const winResult = simulateBacktestDay([winningSymbol], 49, 1, 2)!;
    const lossResult = simulateBacktestDay([losingSymbol], 49, 1, 2)!;

    const rawWinReturn = ((120 - 100) / 100) * 100; // 20%
    const rawLossReturn = ((80 - 100) / 100) * 100; // -20%

    expect(winResult.trades[0].pnl_pct).toBeLessThan(rawWinReturn); // slippage eats into the win
    expect(lossResult.trades[0].pnl_pct).toBeLessThan(rawLossReturn); // slippage makes the loss worse, not better
  });

  it("crypto symbols get a wider (higher-bps) slippage adjustment than stocks, reflected in a larger gap from the raw price", () => {
    // Build two otherwise-identical fixtures, one crypto-named, one not,
    // and confirm the crypto one's entry deviates further from the raw
    // opens[50]=100 price — crypto's base spread (6bps) and liquidity
    // multiplier (2.5x unknown) are both higher than stock's (2bps, 2.0x).
    const stockSymbol = buildSymbol("XYZ", 110, [100], [105, 108, 110]);
    const cryptoSymbol = buildSymbol("BTC-USD", 110, [100], [105, 108, 110]);
    const stockResult = simulateBacktestDay([stockSymbol], 49, 1, 2)!;
    const cryptoResult = simulateBacktestDay([cryptoSymbol], 49, 1, 2)!;

    const stockEntryDeviation = Math.abs(stockResult.trades[0].entry - 100);
    const cryptoEntryDeviation = Math.abs(cryptoResult.trades[0].entry - 100);
    expect(cryptoEntryDeviation).toBeGreaterThan(stockEntryDeviation);
  });

  it("the entry price is NEVER equal to the price used for scoring — the exact bug this fix closes", () => {
    // Reusing the same fixture: the scoring price is closes[49]=110,
    // the entry price is opens[50]=100 — these must differ, confirming
    // the same-bar execution bias no longer exists.
    const symbolA = buildSymbol("A", 110, [100], [105, 108, 110]);
    const result = simulateBacktestDay([symbolA], 49, 1, 2)!;
    const scoringPrice = 110; // closes[49], what generated the signal
    expect(result.trades[0].entry).not.toBe(scoringPrice);
  });

  it("picks the top N symbols by momentum, ranked correctly, when picksPerDay > 1", () => {
    const symbolA = buildSymbol("A", 110, [100], [100]); // highest momentum
    const symbolB = buildSymbol("B", 105, [100], [100]); // middle
    const symbolC = buildSymbol("C", 90, [100], [100]); // lowest (negative momentum)
    const result = simulateBacktestDay([symbolC, symbolA, symbolB], 49, 2, 0)!;
    expect(result.trades).toHaveLength(2);
    expect(result.trades.map((t) => t.symbol)).toEqual(["A", "B"]); // A and B chosen, not C, in momentum order
  });

  it("returns null when no symbol has enough history for SMA50 yet", () => {
    const tooShort: SymBars = { symbol: "X", times: [0, 1, 2], opens: [100, 100, 100], closes: [100, 100, 100] };
    expect(simulateBacktestDay([tooShort], 2, 1, 1)).toBeNull();
  });

  it("skips a symbol with a missing/invalid entry price rather than crashing or producing NaN", () => {
    const symbolA = buildSymbol("A", 110, [100], [105, 108, 110]);
    // Truncate opens so opens[50] is undefined — simulates a data gap
    symbolA.opens = symbolA.opens.slice(0, 50);
    const result = simulateBacktestDay([symbolA], 49, 1, 2);
    expect(result).toBeNull(); // the only candidate had no valid entry, so no trades at all
  });
});

describe("lastValidSimulationDay", () => {
  it("computes the correct hand-verified boundary for a known series length and holdDays", () => {
    // seriesLength=100, holdDays=3 -> last valid day where day+1+holdDays < 100
    // day + 4 < 100 -> day < 96 -> last valid day = 95
    expect(lastValidSimulationDay(100, 3)).toBe(95);
  });

  it("the returned day, when used, keeps day+1+holdDays strictly within bounds", () => {
    const seriesLength = 60;
    const holdDays = 5;
    const lastDay = lastValidSimulationDay(seriesLength, holdDays);
    expect(lastDay + 1 + holdDays).toBeLessThan(seriesLength);
  });
});
