import { describe, it, expect } from "vitest";
import { estimateFees, computeCostRealityReport, type CostRealityInput } from "@/lib/cost-reality";

describe("estimateFees", () => {
  it("charges zero fees for stocks, ETFs, and crypto", () => {
    expect(estimateFees("stock")).toBe(0);
    expect(estimateFees("etf")).toBe(0);
    expect(estimateFees("crypto")).toBe(0);
  });

  it("computes the correct hand-verified fee for a single-leg option", () => {
    // $0.65/contract * 1 leg * 1 contract * 2 (open+close) = $1.30
    expect(estimateFees("call", 1)).toBeCloseTo(1.3, 5);
  });

  it("computes the correct hand-verified fee for a 2-leg spread", () => {
    // $0.65 * 2 legs * 1 contract * 2 (open+close) = $2.60
    expect(estimateFees("call_spread", 1)).toBeCloseTo(2.6, 5);
    expect(estimateFees("put_spread", 1)).toBeCloseTo(2.6, 5);
  });

  it("computes the correct hand-verified fee for a 4-leg iron condor", () => {
    // $0.65 * 4 legs * 1 contract * 2 (open+close) = $5.20
    expect(estimateFees("iron_condor", 1)).toBeCloseTo(5.2, 5);
  });

  it("scales linearly with contract count", () => {
    expect(estimateFees("call", 3)).toBeCloseTo(estimateFees("call", 1) * 3, 5);
  });
});

function trade(overrides: Partial<CostRealityInput>): CostRealityInput {
  return {
    side: "buy",
    entry_price: 100,
    exit_price: 105,
    entry_quoted_price: null,
    exit_quoted_price: null,
    estimated_fees: null,
    rationale: "[SCALP] test",
    created_at: "2026-01-01T10:00:00Z",
    closed_at: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

describe("computeCostRealityReport", () => {
  it("computes the correct hand-verified gross vs net expectancy for a mixed win/loss pair", () => {
    // Trade 1 (win): net 100->110 (+10%), gross (pre-slippage) 100->112 (+12%)
    // Trade 2 (loss): net 100->95 (-5%), gross (pre-slippage) 100->94 (-6%)
    // avgNetReturnPct = (10 + -5)/2 = 2.5
    // avgGrossReturnPct = (12 + -6)/2 = 3
    // avgSlippageCostPct = 3 - 2.5 = 0.5
    const trades: CostRealityInput[] = [
      trade({ entry_price: 100, exit_price: 110, entry_quoted_price: 100, exit_quoted_price: 112 }),
      trade({ entry_price: 100, exit_price: 95, entry_quoted_price: 100, exit_quoted_price: 94 }),
    ];
    const report = computeCostRealityReport(trades);
    const scalp = report.find((r) => r.sessionType === "scalp")!;
    expect(scalp).toBeDefined();
    expect(scalp.avgNetReturnPct).toBeCloseTo(2.5, 3);
    expect(scalp.avgGrossReturnPct).toBeCloseTo(3, 3);
    expect(scalp.avgSlippageCostPct).toBeCloseTo(0.5, 3);
    expect(scalp.stillPositiveAfterCosts).toBe(true);
  });

  it("correctly separates scalp, swing, and crypto trades by their rationale tag", () => {
    const trades: CostRealityInput[] = [
      trade({ rationale: "[SCALP] test" }),
      trade({ rationale: "[SWING] test" }),
      trade({ rationale: "[CRYPTO] test" }),
      trade({ rationale: "no tag at all" }),
    ];
    const report = computeCostRealityReport(trades);
    expect(report.find((r) => r.sessionType === "scalp")?.tradeCount).toBe(1);
    expect(report.find((r) => r.sessionType === "swing")?.tradeCount).toBe(1);
    expect(report.find((r) => r.sessionType === "crypto")?.tradeCount).toBe(1);
    expect(report.find((r) => r.sessionType === "other")?.tradeCount).toBe(1);
  });

  it("honestly separates tradesWithCostData from tradeCount — a trade missing quoted prices contributes to net but not gross", () => {
    const trades: CostRealityInput[] = [
      trade({ entry_quoted_price: 100, exit_quoted_price: 110 }), // has cost data
      trade({ entry_quoted_price: null, exit_quoted_price: null }), // predates cost tracking
    ];
    const report = computeCostRealityReport(trades);
    const scalp = report.find((r) => r.sessionType === "scalp")!;
    expect(scalp.tradeCount).toBe(2); // both count toward net return
    expect(scalp.tradesWithCostData).toBe(1); // only one has gross-return data
  });

  it("computes holding duration correctly from created_at/closed_at", () => {
    const trades: CostRealityInput[] = [
      trade({ created_at: "2026-01-01T10:00:00Z", closed_at: "2026-01-01T13:00:00Z" }), // 3 hours
    ];
    const report = computeCostRealityReport(trades);
    expect(report.find((r) => r.sessionType === "scalp")?.avgHoldingHours).toBeCloseTo(3, 1);
  });

  it("correctly reverses the sign for a short position (side='sell')", () => {
    // A short that moves from 100 down to 90 is a WIN for the short seller (+10%), not a loss.
    const trades: CostRealityInput[] = [trade({ side: "sell", entry_price: 100, exit_price: 90 })];
    const report = computeCostRealityReport(trades);
    expect(report.find((r) => r.sessionType === "scalp")?.avgNetReturnPct).toBeCloseTo(10, 3);
  });

  it("returns an empty array for no trades", () => {
    expect(computeCostRealityReport([])).toEqual([]);
  });
});
