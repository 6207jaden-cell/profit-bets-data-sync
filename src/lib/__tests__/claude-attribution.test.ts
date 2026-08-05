import { describe, it, expect } from "vitest";
import { computeClaudeAttribution } from "@/lib/shadow-experiments";

function makeMockSupabase(rows: Array<{ agreement: string; hypothetical_return_pct: number }>) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: boolean) => ({
            not: async (_col3: string, _op: string, _val3: unknown) => ({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  } as any;
}

describe("computeClaudeAttribution", () => {
  it("computes the correct hand-verified head-to-head comparison for a known set of resolved rows", async () => {
    // Claude's picks = agree_traded + disagree_claude_added = [5, 3, 8] -> avg = 16/3 = 5.333
    // Deterministic-only = agree_traded + disagree_claude_skipped = [5, 3, -2] -> avg = 6/3 = 2.0
    // claudeAddedValue = 5.333 - 2.0 = 3.333
    const mock = makeMockSupabase([
      { agreement: "agree_traded", hypothetical_return_pct: 5 },
      { agreement: "agree_traded", hypothetical_return_pct: 3 },
      { agreement: "disagree_claude_added", hypothetical_return_pct: 8 },
      { agreement: "disagree_claude_skipped", hypothetical_return_pct: -2 },
      { agreement: "agree_skipped", hypothetical_return_pct: -10 },
    ]);
    const result = await computeClaudeAttribution(mock, "user-1");
    expect(result.claudePicksAvgReturnPct).toBeCloseTo(5.333, 2);
    expect(result.claudePicksSampleSize).toBe(3);
    expect(result.deterministicOnlyAvgReturnPct).toBeCloseTo(2.0, 2);
    expect(result.deterministicOnlySampleSize).toBe(3);
    expect(result.claudeAddedValuePct).toBeCloseTo(3.333, 2);
    expect(result.totalResolvedSampleSize).toBe(5);
  });

  it("agree_traded rows count toward BOTH claude picks and deterministic-only — both systems agreed on them", async () => {
    const mock = makeMockSupabase([{ agreement: "agree_traded", hypothetical_return_pct: 10 }]);
    const result = await computeClaudeAttribution(mock, "user-1");
    expect(result.claudePicksSampleSize).toBe(1);
    expect(result.deterministicOnlySampleSize).toBe(1);
  });

  it("returns the empty/null result when there is no resolved data yet", async () => {
    const mock = makeMockSupabase([]);
    const result = await computeClaudeAttribution(mock, "user-1");
    expect(result.claudePicksAvgReturnPct).toBeNull();
    expect(result.claudeAddedValuePct).toBeNull();
    expect(result.hasMinimumEvidence).toBe(false);
  });

  it("hasMinimumEvidence is false below the 30-sample floor on either side, even with plenty of total data", async () => {
    const rows = Array.from({ length: 25 }, () => ({ agreement: "agree_traded", hypothetical_return_pct: 1 }));
    const mock = makeMockSupabase(rows);
    const result = await computeClaudeAttribution(mock, "user-1");
    expect(result.claudePicksSampleSize).toBe(25);
    expect(result.hasMinimumEvidence).toBe(false); // 25 < 30
  });

  it("hasMinimumEvidence is true once both sides reach the 30-sample floor", async () => {
    const rows = Array.from({ length: 30 }, () => ({ agreement: "agree_traded", hypothetical_return_pct: 1 }));
    const mock = makeMockSupabase(rows);
    const result = await computeClaudeAttribution(mock, "user-1");
    expect(result.hasMinimumEvidence).toBe(true);
  });

  it("a negative claudeAddedValuePct correctly indicates Claude's picks underperformed the deterministic ranking", async () => {
    const mock = makeMockSupabase([
      { agreement: "disagree_claude_added", hypothetical_return_pct: -5 },
      { agreement: "disagree_claude_skipped", hypothetical_return_pct: 10 },
    ]);
    const result = await computeClaudeAttribution(mock, "user-1");
    expect(result.claudeAddedValuePct).toBeLessThan(0);
  });
});
