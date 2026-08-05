import { describe, it, expect } from "vitest";
import { computeSignalContribution } from "@/lib/signal-learning";

function makeMockSupabase(rows: Array<Record<string, unknown>>) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: async (_col: string, _val: string) => ({ data: rows, error: null }),
      }),
    }),
  } as any;
}

describe("computeSignalContribution", () => {
  it("computes the correct hand-verified contribution for a signal with more data than the absent side", async () => {
    // Present: alpha=15,beta=5 -> winRate=0.75, avg_pnl_pct=3, sample_size=20
    // Absent:  alpha=10,beta=10 -> winRate=0.5, avg_pnl_pct=1, sample_size=20
    // contributionPct = presentAvgPnlPct - absentAvgPnlPct = 3 - 1 = 2
    const mock = makeMockSupabase([{
      signal_name: "macd_bullish",
      alpha: 15, beta: 5, sample_size: 20, avg_pnl_pct: 3,
      absent_alpha: 10, absent_beta: 10, absent_sample_size: 20, absent_avg_pnl_pct: 1,
    }]);
    const rows = await computeSignalContribution(mock, "user-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].presentWinRate).toBeCloseTo(0.75, 3);
    expect(rows[0].absentWinRate).toBeCloseTo(0.5, 3);
    expect(rows[0].contributionPct).toBeCloseTo(2, 3);
    expect(rows[0].hasMinimumEvidence).toBe(true);
  });

  it("flags hasMinimumEvidence: false when either side is below the 10-sample floor", async () => {
    const mock = makeMockSupabase([{
      signal_name: "new_signal",
      alpha: 3, beta: 1, sample_size: 4, avg_pnl_pct: 5,
      absent_alpha: 20, absent_beta: 20, absent_sample_size: 40, absent_avg_pnl_pct: 1,
    }]);
    const rows = await computeSignalContribution(mock, "user-1");
    expect(rows[0].hasMinimumEvidence).toBe(false);
  });

  it("correctly flags the known mutually-exclusive signal pairs", async () => {
    const mock = makeMockSupabase([
      { signal_name: "rsi_oversold", alpha: 1, beta: 1, sample_size: 0, avg_pnl_pct: 0, absent_alpha: 1, absent_beta: 1, absent_sample_size: 0, absent_avg_pnl_pct: 0 },
      { signal_name: "volume_surge", alpha: 1, beta: 1, sample_size: 0, avg_pnl_pct: 0, absent_alpha: 1, absent_beta: 1, absent_sample_size: 0, absent_avg_pnl_pct: 0 },
    ]);
    const rows = await computeSignalContribution(mock, "user-1");
    expect(rows.find((r) => r.signalName === "rsi_oversold")?.isMutuallyExclusivePair).toBe(true);
    expect(rows.find((r) => r.signalName === "volume_surge")?.isMutuallyExclusivePair).toBe(false);
  });

  it("a negative contribution correctly indicates the signal performs WORSE when present than absent", async () => {
    const mock = makeMockSupabase([{
      signal_name: "suspect_signal",
      alpha: 5, beta: 15, sample_size: 20, avg_pnl_pct: -2,
      absent_alpha: 15, absent_beta: 5, absent_sample_size: 20, absent_avg_pnl_pct: 3,
    }]);
    const rows = await computeSignalContribution(mock, "user-1");
    expect(rows[0].contributionPct).toBeLessThan(0);
    expect(rows[0].contributionPct).toBeCloseTo(-5, 3);
  });

  it("sorts results by present-side sample size, most-observed signal first", async () => {
    const mock = makeMockSupabase([
      { signal_name: "small_sample", alpha: 1, beta: 1, sample_size: 3, avg_pnl_pct: 0, absent_alpha: 1, absent_beta: 1, absent_sample_size: 0, absent_avg_pnl_pct: 0 },
      { signal_name: "big_sample", alpha: 1, beta: 1, sample_size: 50, avg_pnl_pct: 0, absent_alpha: 1, absent_beta: 1, absent_sample_size: 0, absent_avg_pnl_pct: 0 },
    ]);
    const rows = await computeSignalContribution(mock, "user-1");
    expect(rows[0].signalName).toBe("big_sample");
    expect(rows[1].signalName).toBe("small_sample");
  });

  it("returns an empty array when no signal weight rows exist for this user yet", async () => {
    const mock = makeMockSupabase([]);
    const rows = await computeSignalContribution(mock, "user-1");
    expect(rows).toEqual([]);
  });
});
