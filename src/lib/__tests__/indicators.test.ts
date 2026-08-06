import { describe, it, expect } from "vitest";
import { atr, computeCorrelation, isQuoteStale } from "@/lib/indicators";

describe("atr", () => {
  it("computes the correct value for a constant-true-range series", () => {
    // Every bar: high=101, low=99, previous close=100 -> true range = max(2, 1, 1) = 2
    // for every bar after the first. ATR should converge to exactly 2 regardless
    // of the smoothing formula, since the input is constant.
    const highs = Array(20).fill(101);
    const lows = Array(20).fill(99);
    const closes = Array(20).fill(100);
    const result = atr(highs, lows, closes, 14);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(2, 5);
  });

  it("returns null when there is insufficient data for the requested period", () => {
    const highs = [101, 102, 103];
    const lows = [99, 100, 101];
    const closes = [100, 101, 102];
    expect(atr(highs, lows, closes, 14)).toBeNull();
  });

  it("reacts to a volatility spike — ATR after a large-range bar is higher than before it", () => {
    const n = 20;
    const highs = Array(n).fill(101);
    const lows = Array(n).fill(99);
    const closes = Array(n).fill(100);
    const before = atr(highs, lows, closes, 14)!;

    // Inject one large-range bar near the end
    const highsSpiked = [...highs];
    const lowsSpiked = [...lows];
    highsSpiked[n - 1] = 130;
    lowsSpiked[n - 1] = 90;
    const after = atr(highsSpiked, lowsSpiked, closes, 14)!;

    expect(after).toBeGreaterThan(before);
  });
});

describe("computeCorrelation", () => {
  it("returns ~1.0 for two perfectly correlated (identical) return series", () => {
    const closesA = [100, 102, 101, 105, 103, 108, 106, 110, 109, 115];
    const closesB = [50, 51, 50.5, 52.5, 51.5, 54, 53, 55, 54.5, 57.5]; // exactly half of A at every point -> identical % returns
    const result = computeCorrelation(closesA, closesB, 30);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0.999);
  });

  it("returns ~-1.0 for two perfectly inversely correlated series", () => {
    const closesA = [100, 102, 101, 105, 103, 108, 106, 110, 109, 115];
    // Mirror A's percentage moves in the opposite direction
    const closesB: number[] = [100];
    for (let i = 1; i < closesA.length; i++) {
      const retA = (closesA[i] - closesA[i - 1]) / closesA[i - 1];
      closesB.push(closesB[i - 1] * (1 - retA));
    }
    const result = computeCorrelation(closesA, closesB, 30);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(-0.999);
  });

  it("returns null when there isn't enough data for a meaningful estimate", () => {
    const closesA = [100, 101, 102];
    const closesB = [50, 51, 52];
    expect(computeCorrelation(closesA, closesB, 30)).toBeNull();
  });

  it("respects the lookback window — a correlation-breaking prefix outside the window doesn't affect the result", () => {
    // First 10 points are uncorrelated noise; last 12 points are identical (perfectly correlated).
    // With a lookback that only reaches into the correlated tail, result should be ~1.0.
    const noise = [100, 95, 103, 90, 110, 88, 105, 92, 108, 91];
    const correlatedTail = [100, 102, 101, 105, 103, 108, 106, 110, 109, 115, 112, 118];
    const closesA = [...noise, ...correlatedTail];
    const closesB = [...noise.map((v) => v + 500), ...correlatedTail]; // same tail values exactly
    const result = computeCorrelation(closesA, closesB, 10); // lookback shorter than the noisy prefix
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0.99);
  });
});

describe("isQuoteStale", () => {
  it("returns false when the quote is within the max age", () => {
    const now = 1_000_000_000_000;
    const quoteTime = now - 10 * 60_000; // 10 minutes ago
    expect(isQuoteStale(quoteTime, now, 30)).toBe(false);
  });

  it("returns true when the quote exceeds the max age", () => {
    const now = 1_000_000_000_000;
    const quoteTime = now - 45 * 60_000; // 45 minutes ago
    expect(isQuoteStale(quoteTime, now, 30)).toBe(true);
  });

  it("returns false exactly at the boundary (age == maxAge is not yet stale, only age > maxAge is)", () => {
    const now = 1_000_000_000_000;
    const quoteTime = now - 30 * 60_000; // exactly 30 minutes ago
    expect(isQuoteStale(quoteTime, now, 30)).toBe(false);
  });

  it("returns false for a missing timestamp — 'cannot determine staleness' is not the same as 'assume stale'", () => {
    const now = 1_000_000_000_000;
    expect(isQuoteStale(null, now, 30)).toBe(false);
    expect(isQuoteStale(undefined, now, 30)).toBe(false);
  });

  it("returns false for an invalid (zero, negative, or non-finite) timestamp rather than throwing or misbehaving", () => {
    const now = 1_000_000_000_000;
    expect(isQuoteStale(0, now, 30)).toBe(false);
    expect(isQuoteStale(-100, now, 30)).toBe(false);
    expect(isQuoteStale(NaN, now, 30)).toBe(false);
  });

  it("a quote timestamp in the future (clock skew) is not treated as stale", () => {
    const now = 1_000_000_000_000;
    const futureQuoteTime = now + 5 * 60_000; // 5 minutes in the future
    expect(isQuoteStale(futureQuoteTime, now, 30)).toBe(false);
  });
});
