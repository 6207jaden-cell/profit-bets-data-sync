import { describe, it, expect } from "vitest";
import { isImplausibleReturnPct, IMPLAUSIBLE_RETURN_PCT } from "@/lib/data-quality";

/**
 * Guards the data-quality screen that shadow-experiment resolution
 * (resolve-shadow-experiments.ts) applies before writing
 * hypothetical_return_pct. Without it, a corrupted quote pair (the
 * MATIC-USD rows found on 2026-09-20: 0.2164 at scan vs 0.3794 at
 * resolution, repeated across 62 rows) is silently written as a real
 * outcome and then read straight into the adaptive-weighting attribution.
 */
describe("isImplausibleReturnPct", () => {
  it("treats a missing return as unknown, not implausible", () => {
    expect(isImplausibleReturnPct(null)).toBe(false);
    expect(isImplausibleReturnPct(undefined)).toBe(false);
  });

  it("accepts ordinary returns, including large but real ones", () => {
    expect(isImplausibleReturnPct(0)).toBe(false);
    expect(isImplausibleReturnPct(-12.4)).toBe(false);
    expect(isImplausibleReturnPct(75.3)).toBe(false);
    expect(isImplausibleReturnPct(IMPLAUSIBLE_RETURN_PCT)).toBe(false);
  });

  it("rejects returns beyond the shared implausibility threshold, in both directions", () => {
    expect(isImplausibleReturnPct(IMPLAUSIBLE_RETURN_PCT + 0.01)).toBe(true);
    expect(isImplausibleReturnPct(-400)).toBe(true);
  });

  it("rejects non-finite values, which can only come from a bad denominator", () => {
    expect(isImplausibleReturnPct(Number.POSITIVE_INFINITY)).toBe(true);
    expect(isImplausibleReturnPct(Number.NaN)).toBe(true);
  });
});
