import { describe, it, expect } from "vitest";
import { computeDirectionalScores } from "@/lib/signal-learning";

// Neutral baseline: every field set to a value that shouldn't trigger ANY
// signal in either direction, so each test can isolate exactly one signal
// by overriding a single field and checking it lands ONLY on the correct
// side. This directly validates the core fix Stage 2 exists for: the
// original opportunityScore added points for RSI>70 AND RSI<30
// simultaneously into one undifferentiated total — these tests confirm
// that bug cannot recur.
const neutral = {
  rsi: 50,
  momentum_pct: 0,
  vol_surge_pct: 0,
  five_day_return: 0,
  twenty_day_return: 0,
  rs_vs_spy_5d: 0,
  regime_aligned: false,
  macd_histogram: 0,
  bb_pct_b: 0.5,
  avg_volume_20d: 1_000_000,
  stoch_rsi_k: 50,
};

describe("computeDirectionalScores", () => {
  it("RSI oversold (<30) contributes ONLY to bullScore, never bearScore", () => {
    const result = computeDirectionalScores({ ...neutral, rsi: 25 }, "sideways");
    expect(result.bullScore).toBeGreaterThan(0);
    expect(result.bearScore).toBe(0);
    expect(result.bullSignals).toContain("rsi_oversold");
    expect(result.bearSignals).not.toContain("rsi_oversold");
  });

  it("RSI overbought (>70) contributes ONLY to bearScore, never bullScore", () => {
    const result = computeDirectionalScores({ ...neutral, rsi: 75 }, "sideways");
    expect(result.bearScore).toBeGreaterThan(0);
    expect(result.bullScore).toBe(0);
    expect(result.bearSignals).toContain("rsi_overbought");
  });

  it("neutral RSI (30-70) triggers neither oversold nor overbought", () => {
    const result = computeDirectionalScores({ ...neutral, rsi: 50 }, "sideways");
    expect(result.bullSignals).not.toContain("rsi_oversold");
    expect(result.bearSignals).not.toContain("rsi_overbought");
  });

  it("positive MACD histogram contributes only to bullScore", () => {
    const result = computeDirectionalScores({ ...neutral, macd_histogram: 0.5 }, "sideways");
    expect(result.bullSignals).toContain("macd_bullish");
    expect(result.bearSignals).not.toContain("macd_bullish");
    expect(result.bearScore).toBe(0);
  });

  it("negative MACD histogram contributes only to bearScore", () => {
    const result = computeDirectionalScores({ ...neutral, macd_histogram: -0.5 }, "sideways");
    expect(result.bearSignals).toContain("macd_bearish");
    expect(result.bullScore).toBe(0);
  });

  it("Bollinger lower band (oversold, mean-reversion) contributes only to bullScore", () => {
    const result = computeDirectionalScores({ ...neutral, bb_pct_b: 0.02 }, "sideways");
    expect(result.bullSignals).toContain("bb_lower_band");
    expect(result.bearScore).toBe(0);
  });

  it("Bollinger upper band contributes only to bearScore", () => {
    const result = computeDirectionalScores({ ...neutral, bb_pct_b: 0.98 }, "sideways");
    expect(result.bearSignals).toContain("bb_upper_band");
    expect(result.bullScore).toBe(0);
  });

  it("flags genuine conflict when strong bullish and bearish signals fire simultaneously", () => {
    // Positive momentum (bullish) + RSI overbought (bearish) — a real,
    // plausible "choppy" scenario the conflictScore exists to catch.
    const result = computeDirectionalScores({ ...neutral, momentum_pct: 5, rsi: 75 }, "sideways");
    expect(result.bullScore).toBeGreaterThan(0);
    expect(result.bearScore).toBeGreaterThan(0);
    expect(result.conflictScore).toBeGreaterThan(0);
    expect(result.conflictScore).toBe(Math.min(result.bullScore, result.bearScore));
  });

  it("a fully neutral candidate produces zero score on both sides and zero confidence", () => {
    const result = computeDirectionalScores(neutral, "sideways");
    expect(result.bullScore).toBe(0);
    expect(result.bearScore).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it("regime alignment bonus applies to the correct side only", () => {
    const bullInBullRegime = computeDirectionalScores({ ...neutral, momentum_pct: 1 }, "bull");
    const bullInBearRegime = computeDirectionalScores({ ...neutral, momentum_pct: 1 }, "bear");
    // Same positive-momentum candidate should score higher in a bull regime
    // (aligned) than in a bear regime (not aligned) — the regime bonus only
    // fires when momentum direction matches the regime.
    expect(bullInBullRegime.bullScore).toBeGreaterThan(bullInBearRegime.bullScore);
  });

  it("confidence is high (near 1) when only one direction has any signal, low when both are equal", () => {
    const oneSided = computeDirectionalScores({ ...neutral, rsi: 25 }, "sideways"); // bull only
    const balanced = computeDirectionalScores({ ...neutral, momentum_pct: 5, rsi: 75 }, "sideways"); // both fire, may not be perfectly equal but should be lower confidence than one-sided
    expect(oneSided.confidence).toBe(1); // bearScore is exactly 0, so confidence = |bull-0|/(bull+0) = 1
    expect(balanced.confidence).toBeLessThan(oneSided.confidence);
  });
});
