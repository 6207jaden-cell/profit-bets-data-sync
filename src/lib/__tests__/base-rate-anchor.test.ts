import { describe, it, expect } from "vitest";
import {
  computeSignalWeightMultiplier,
  shrunkWinRate,
  WEIGHT_PRIOR_STRENGTH,
} from "@/lib/signal-learning";

/**
 * The defect this guards against (HYPOTHESIS_LOG.md H3, DECISION_LOG.md D-13):
 * the old formula clamp(0.5 + winRate, 0.4, 1.8) anchored "neutral" at a 50%
 * win rate. This account wins ~24% of the time, so every MEASURED signal
 * landed below 1.0x while every never-traded signal sat at exactly 1.0x —
 * adaptive weighting was promoting the absence of evidence.
 */
describe("base-rate anchored signal weights", () => {
  const BASE = 0.2445; // this account's measured pooled win rate

  it("scores an untested signal (n=0) at exactly neutral 1.0x", () => {
    expect(computeSignalWeightMultiplier(0, 0, BASE)).toBeCloseTo(1.0, 10);
  });

  it("scores a signal performing exactly at the base rate at the SAME value as an untested one — the core of the fix", () => {
    const atBaseRate = computeSignalWeightMultiplier(Math.round(400 * BASE), 400, BASE);
    const untested = computeSignalWeightMultiplier(0, 0, BASE);
    expect(atBaseRate).toBeCloseTo(untested, 2);
    expect(atBaseRate).toBeCloseTo(1.0, 2);
  });

  it("holds that equivalence at any base rate, not just this account's current one", () => {
    for (const base of [0.05, 0.2445, 0.5, 0.75, 0.95]) {
      const untested = computeSignalWeightMultiplier(0, 0, base);
      expect(untested).toBeCloseTo(1.0, 10);
      const n = 1000;
      const atBase = computeSignalWeightMultiplier(base * n, n, base);
      expect(atBase).toBeCloseTo(1.0, 10);
    }
  });

  it("boosts a signal beating the base rate and reduces one below it", () => {
    const above = computeSignalWeightMultiplier(200, 400, BASE); // 50% vs 24.45% base
    const below = computeSignalWeightMultiplier(20, 400, BASE); // 5% vs 24.45% base
    expect(above).toBeGreaterThan(1.0);
    expect(below).toBeLessThan(1.0);
    expect(above).toBeGreaterThan(below);
  });

  it("no longer punishes a merely-average signal the way the old 50%-anchored formula did", () => {
    const n = 500;
    const wins = Math.round(n * BASE);
    const old = Math.max(0.4, Math.min(1.8, 0.5 + (wins + 1) / (n + 2)));
    const now = computeSignalWeightMultiplier(wins, n, BASE);
    expect(old).toBeLessThan(0.8); // the old behaviour: average == heavily demoted
    expect(now).toBeCloseTo(1.0, 2); // the new behaviour: average == neutral
  });

  it("keeps a thin sample close to neutral via the base-rate-centred prior", () => {
    // 2 wins in 2 trades looks like a 100% win rate, but with n=2 against a
    // prior worth 20 pseudo-trades it may not run away from neutral.
    const thin = computeSignalWeightMultiplier(2, 2, BASE);
    const thick = computeSignalWeightMultiplier(400, 400, BASE);
    expect(thin).toBeLessThan(1.1);
    expect(thick).toBeGreaterThan(1.5);
  });

  it("stays inside the unchanged [0.4, 1.8] clamp at both extremes", () => {
    expect(computeSignalWeightMultiplier(10_000, 10_000, 0.01)).toBeLessThanOrEqual(1.8);
    expect(computeSignalWeightMultiplier(0, 10_000, 0.99)).toBeGreaterThanOrEqual(0.4);
  });

  it("shrinks toward the base rate with the documented prior strength", () => {
    // 0 wins in `k` trades should sit exactly halfway between 0 and the base rate.
    expect(shrunkWinRate(0, WEIGHT_PRIOR_STRENGTH, BASE)).toBeCloseTo(BASE / 2, 10);
    expect(shrunkWinRate(0, 0, BASE)).toBeCloseTo(BASE, 10);
  });
});
