import { describe, it, expect } from "vitest";
import { computeSignalAttribution } from "@/lib/signal-learning";

function makeMockSupabase(trades: Array<{ pnl: number; entry_signals: string[] | null }>) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: boolean) => ({
            not: async (_col3: string, _op: string, _val3: unknown) => ({ data: trades, error: null }),
          }),
        }),
      }),
    }),
  } as any;
}

describe("computeSignalAttribution", () => {
  it("computes the correct hand-verified dollar P&L attribution for a known trade set", async () => {
    // Trade 1: +$100, signals [A, B]
    // Trade 2: -$40, signals [A]
    // Trade 3: +$60, signals [B, C]
    // Total P&L = 100-40+60 = 120
    // Signal A: 100 + -40 = 60, 2 trades, 60/120*100 = 50%
    // Signal B: 100 + 60 = 160, 2 trades, 160/120*100 ≈ 133.3% (exceeds 100% — expected, see credit-sharing note)
    // Signal C: 60, 1 trade, 60/120*100 = 50%
    const mock = makeMockSupabase([
      { pnl: 100, entry_signals: ["A", "B"] },
      { pnl: -40, entry_signals: ["A"] },
      { pnl: 60, entry_signals: ["B", "C"] },
    ]);
    const result = await computeSignalAttribution(mock, "user-1");
    expect(result.totalPnlDollar).toBeCloseTo(120, 2);
    expect(result.tradeCount).toBe(3);

    const a = result.rows.find((r) => r.signalName === "A")!;
    expect(a.totalPnlDollar).toBeCloseTo(60, 2);
    expect(a.tradeCount).toBe(2);
    expect(a.pctOfTotalPnl).toBeCloseTo(50, 1);

    const b = result.rows.find((r) => r.signalName === "B")!;
    expect(b.totalPnlDollar).toBeCloseTo(160, 2);
    expect(b.pctOfTotalPnl).toBeCloseTo(133.3, 1);

    const c = result.rows.find((r) => r.signalName === "C")!;
    expect(c.totalPnlDollar).toBeCloseTo(60, 2);
    expect(c.pctOfTotalPnl).toBeCloseTo(50, 1);
  });

  it("percentages across signals commonly sum to MORE than 100% due to co-occurring signals sharing full credit — this is expected, not a bug", async () => {
    const mock = makeMockSupabase([{ pnl: 100, entry_signals: ["A", "B", "C"] }]);
    const result = await computeSignalAttribution(mock, "user-1");
    const sumOfPct = result.rows.reduce((s, r) => s + (r.pctOfTotalPnl ?? 0), 0);
    expect(sumOfPct).toBeCloseTo(300, 1); // all 3 signals get 100% credit each for the one trade
  });

  it("handles trades with no entry_signals (manual trades) by excluding them from every signal's attribution but still counting them in the total", async () => {
    const mock = makeMockSupabase([
      { pnl: 100, entry_signals: ["A"] },
      { pnl: 50, entry_signals: null }, // manual trade, no tracked signals
    ]);
    const result = await computeSignalAttribution(mock, "user-1");
    expect(result.totalPnlDollar).toBeCloseTo(150, 2); // manual trade still counts toward total
    expect(result.tradeCount).toBe(2);
    const a = result.rows.find((r) => r.signalName === "A")!;
    expect(a.totalPnlDollar).toBeCloseTo(100, 2); // but not attributed to any signal
  });

  it("returns pctOfTotalPnl: null when total P&L is exactly zero (avoids divide-by-zero)", async () => {
    const mock = makeMockSupabase([
      { pnl: 50, entry_signals: ["A"] },
      { pnl: -50, entry_signals: ["A"] },
    ]);
    const result = await computeSignalAttribution(mock, "user-1");
    expect(result.totalPnlDollar).toBe(0);
    const a = result.rows.find((r) => r.signalName === "A")!;
    expect(a.pctOfTotalPnl).toBeNull();
  });

  it("sorts signals by total dollar P&L, largest contributor first", async () => {
    const mock = makeMockSupabase([
      { pnl: 10, entry_signals: ["small"] },
      { pnl: 1000, entry_signals: ["big"] },
    ]);
    const result = await computeSignalAttribution(mock, "user-1");
    expect(result.rows[0].signalName).toBe("big");
  });

  it("returns empty rows and zero totals for no closed trades", async () => {
    const mock = makeMockSupabase([]);
    const result = await computeSignalAttribution(mock, "user-1");
    expect(result.rows).toEqual([]);
    expect(result.totalPnlDollar).toBe(0);
  });
});
