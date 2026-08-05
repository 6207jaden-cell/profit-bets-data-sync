import { describe, it, expect } from "vitest";
import { computeBreadthScore, type BreadthCandidate } from "@/lib/market-breadth";

function candidate(oneDayReturn: number, momentum: number, isHigh = false, isLow = false): BreadthCandidate {
  return { one_day_return: oneDayReturn, momentum_pct: momentum, is_220d_high: isHigh, is_220d_low: isLow };
}

describe("computeBreadthScore", () => {
  it("returns neutral defaults for an empty candidate list", () => {
    const result = computeBreadthScore([]);
    expect(result.breadthScore).toBe(50);
    expect(result.adRatioPct).toBe(50);
  });

  it("returns 100 when everything is advancing, above SMA50, and at new highs", () => {
    const candidates = Array(10).fill(null).map(() => candidate(1, 1, true, false));
    const result = computeBreadthScore(candidates);
    expect(result.breadthScore).toBe(100);
    expect(result.adRatioPct).toBe(100);
    expect(result.aboveSma50Pct).toBe(100);
    expect(result.newHighLowRatio).toBe(1);
  });

  it("returns 0 when everything is declining, below SMA50, and at new lows", () => {
    const candidates = Array(10).fill(null).map(() => candidate(-1, -1, false, true));
    const result = computeBreadthScore(candidates);
    expect(result.breadthScore).toBe(0);
    expect(result.adRatioPct).toBe(0);
    expect(result.aboveSma50Pct).toBe(0);
    expect(result.newHighLowRatio).toBe(-1);
  });

  it("computes the correct hand-verified composite for a mixed scan", () => {
    // 10 candidates built explicitly and traceably:
    //   indices 0-5 (6 total): advancing, above SMA50 -> index 0 also a new high
    //   indices 6-7 (2 total): advancing, below SMA50
    //   indices 8-9 (2 total): declining, below SMA50 -> index 8 also a new low
    // adRatioPct = 8 advancing / 10 = 80
    // aboveSma50Pct = 6 above SMA50 / 10 = 60
    // newHighLowRatio = (1 high - 1 low) / 2 total extremes = 0 -> newHighLowScore = (0+1)*50 = 50
    // breadthScore = round(80*0.44 + 60*0.33 + 50*0.23) = round(35.2 + 19.8 + 11.5) = round(66.5) = 67
    const explicit: BreadthCandidate[] = [
      candidate(1, 0.1, true, false), // 0: advancing, above SMA50, new high
      candidate(1, 0.1),              // 1
      candidate(1, 0.1),              // 2
      candidate(1, 0.1),              // 3
      candidate(1, 0.1),              // 4
      candidate(1, 0.1),              // 5: (indices 0-5 = 6 advancing + above SMA50)
      candidate(1, -0.1),             // 6: advancing, below SMA50
      candidate(1, -0.1),             // 7: advancing, below SMA50 (indices 0-7 = 8 advancing total)
      candidate(-1, -0.1, false, true), // 8: declining, below SMA50, new low
      candidate(-1, -0.1),            // 9: declining, below SMA50
    ];

    const result = computeBreadthScore(explicit);
    expect(result.adRatioPct).toBe(80);
    expect(result.aboveSma50Pct).toBe(60);
    expect(result.newHighLowRatio).toBe(0);
    expect(result.breadthScore).toBe(67);
  });

  it("aboveSma50Pct and adRatioPct are independent — a stock can advance today while still being below its own 50-day average", () => {
    // 1-day return positive, but momentum (vs SMA50) negative — a real, common scenario
    const candidates = [candidate(1, -5), candidate(1, -5)];
    const result = computeBreadthScore(candidates);
    expect(result.adRatioPct).toBe(100);
    expect(result.aboveSma50Pct).toBe(0);
  });
});
