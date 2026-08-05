import { describe, it, expect } from "vitest";
import { computeKellySizeMultiplier, type SignalStatsMap } from "@/lib/signal-learning";

describe("computeKellySizeMultiplier", () => {
  it("returns neutral (1.0x) with no entry signals", () => {
    const result = computeKellySizeMultiplier(null, new Map());
    expect(result.multiplier).toBe(1.0);
    expect(result.kellyFractionPct).toBeNull();
  });

  it("returns neutral (1.0x) below the minimum sample size", () => {
    const stats: SignalStatsMap = new Map([
      ["rsi_oversold", { weightMultiplier: 1, winRate: 0.6, avgWinPct: 4, avgLossPct: 2, sampleSize: 5 }],
    ]);
    const result = computeKellySizeMultiplier(["rsi_oversold"], stats, 15);
    expect(result.multiplier).toBe(1.0);
    expect(result.kellyFractionPct).toBeNull();
  });

  it("computes the correct hand-verified Kelly fraction for a positive-edge signal (hits the 1.8x cap)", () => {
    // p=0.6, avgWin=4, avgLoss=2 -> b=2
    // fullKelly = (2*0.6 - 0.4)/2 = 0.4
    // fractionalKelly (40%) = 0.16 -> kellyFractionPct = 16 (within the 0-25 clamp)
    // multiplier = clamp(16/8, 0.4, 1.8) = 1.8 (hits the hard cap)
    const stats: SignalStatsMap = new Map([
      ["macd_bullish", { weightMultiplier: 1.2, winRate: 0.6, avgWinPct: 4, avgLossPct: 2, sampleSize: 20 }],
    ]);
    const result = computeKellySizeMultiplier(["macd_bullish"], stats, 15);
    expect(result.kellyFractionPct).toBeCloseTo(16, 1);
    expect(result.multiplier).toBeCloseTo(1.8, 3);
  });

  it("computes the correct hand-verified Kelly fraction for a negative-edge signal (hits the 0.4x floor)", () => {
    // p=0.3, avgWin=2, avgLoss=3 -> b=2/3
    // fullKelly = (2/3*0.3 - 0.7)/(2/3) = -0.75
    // fractionalKelly = -0.3 -> clamped to 0 (can't be negative) -> kellyFractionPct = 0
    // multiplier = clamp(0/8, 0.4, 1.8) = 0.4 (hits the hard floor)
    const stats: SignalStatsMap = new Map([
      ["rsi_overbought", { weightMultiplier: 0.8, winRate: 0.3, avgWinPct: 2, avgLossPct: 3, sampleSize: 20 }],
    ]);
    const result = computeKellySizeMultiplier(["rsi_overbought"], stats, 15);
    expect(result.kellyFractionPct).toBeCloseTo(0, 1);
    expect(result.multiplier).toBeCloseTo(0.4, 3);
  });

  it("picks the signal with the largest sample size when multiple are active, not the first or best-looking one", () => {
    const stats: SignalStatsMap = new Map([
      ["signal_a", { weightMultiplier: 1, winRate: 0.9, avgWinPct: 10, avgLossPct: 1, sampleSize: 16 }], // looks great, small sample
      ["signal_b", { weightMultiplier: 1, winRate: 0.55, avgWinPct: 3, avgLossPct: 2, sampleSize: 100 }], // more modest, but far more evidence
    ]);
    const result = computeKellySizeMultiplier(["signal_a", "signal_b"], stats, 15);
    // Should be driven by signal_b's numbers (largest sample), not signal_a's
    expect(result.reason).toContain("signal_b");
  });

  it("does not activate when avgLossPct is zero (no losses recorded yet — division-by-zero guard)", () => {
    const stats: SignalStatsMap = new Map([
      ["untested_signal", { weightMultiplier: 1, winRate: 1.0, avgWinPct: 5, avgLossPct: 0, sampleSize: 20 }],
    ]);
    const result = computeKellySizeMultiplier(["untested_signal"], stats, 15);
    expect(result.multiplier).toBe(1.0);
    expect(result.kellyFractionPct).toBeNull();
  });
});
