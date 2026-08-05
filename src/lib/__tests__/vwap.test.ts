import { describe, it, expect } from "vitest";
import { computeVwap, type IntradayBar } from "@/lib/indicators";

function bar(h: number, l: number, c: number, v: number, t = 0): IntradayBar {
  return { t, o: c, h, l, c, v };
}

describe("computeVwap", () => {
  it("computes exact VWAP for constant-price bars — should equal the price with zero-width bands", () => {
    const bars: IntradayBar[] = [bar(100, 100, 100, 10), bar(100, 100, 100, 20), bar(100, 100, 100, 30)];
    const result = computeVwap(bars);
    expect(result).not.toBeNull();
    expect(result!.vwap).toBeCloseTo(100, 5);
    expect(result!.upperBand1).toBeCloseTo(100, 5);
    expect(result!.lowerBand1).toBeCloseTo(100, 5);
    expect(result!.position).toBe("near_vwap");
  });

  it("weights VWAP toward the higher-volume bar, not a simple average", () => {
    const bars: IntradayBar[] = [bar(100, 100, 100, 1), bar(150, 150, 150, 1), bar(200, 200, 200, 999)];
    const result = computeVwap(bars);
    expect(result).not.toBeNull();
    expect(result!.vwap).toBeGreaterThan(199);
    expect(result!.vwap).toBeLessThan(200);
  });

  it("classifies current price correctly relative to the bands", () => {
    const bars: IntradayBar[] = [
      bar(99, 97, 98, 100),
      bar(101, 99, 100, 100),
      bar(103, 101, 102, 100),
      bar(150, 148, 149, 100),
    ];
    const result = computeVwap(bars);
    expect(result).not.toBeNull();
    expect(result!.currentPrice).toBe(149);
    expect(["above_upper1", "above_upper2"]).toContain(result!.position);
  });

  it("returns null for fewer than 3 bars", () => {
    const bars: IntradayBar[] = [bar(100, 99, 100, 10), bar(101, 100, 101, 10)];
    expect(computeVwap(bars)).toBeNull();
  });

  it("returns null when total volume is zero (all bars filtered/degenerate)", () => {
    const bars: IntradayBar[] = [bar(100, 99, 100, 0), bar(101, 100, 101, 0), bar(102, 101, 102, 0)];
    expect(computeVwap(bars)).toBeNull();
  });
});
