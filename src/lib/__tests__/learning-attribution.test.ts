import { describe, it, expect } from "vitest";
import { computeLearningAttribution } from "@/lib/shadow-experiments";

/**
 * Self-chaining query mock: .eq() returns the same builder so the number of
 * filters the function applies can change (e.g. adding the data_quality_flag
 * filter) without the mock's shape having to be rewritten. Applied filters are
 * recorded so a test can assert flagged rows are excluded.
 */
function makeMockSupabase(rows: Array<{ rank_delta: number; hypothetical_return_pct: number }>) {
  const filters: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (col: string, val: unknown) => { filters.push([col, val]); return builder; };
  builder.not = async () => ({ data: rows, error: null });
  return { mock: { from: () => builder } as any, filters };
}

describe("computeLearningAttribution", () => {
  it("computes the correct hand-verified promoted-vs-demoted comparison for a known set of resolved rows", async () => {
    // promoted (rank_delta > 0): returns [10, 6] -> avg = 8
    // demoted (rank_delta < 0): returns [2, -2] -> avg = 0
    // neutral (rank_delta === 0): return [1] -> not counted in either average
    // learningAddedValue = 8 - 0 = 8
    const { mock } = makeMockSupabase([
      { rank_delta: 2, hypothetical_return_pct: 10 },
      { rank_delta: 1, hypothetical_return_pct: 6 },
      { rank_delta: -1, hypothetical_return_pct: 2 },
      { rank_delta: -3, hypothetical_return_pct: -2 },
      { rank_delta: 0, hypothetical_return_pct: 1 },
    ]);
    const result = await computeLearningAttribution(mock, "user-1");
    expect(result.promotedAvgReturnPct).toBeCloseTo(8, 2);
    expect(result.promotedSampleSize).toBe(2);
    expect(result.demotedAvgReturnPct).toBeCloseTo(0, 2);
    expect(result.demotedSampleSize).toBe(2);
    expect(result.learningAddedValuePct).toBeCloseTo(8, 2);
    expect(result.neutralSampleSize).toBe(1);
    expect(result.totalResolvedSampleSize).toBe(5);
  });

  it("returns the empty/null result when there is no resolved data yet", async () => {
    const { mock } = makeMockSupabase([]);
    const result = await computeLearningAttribution(mock, "user-1");
    expect(result.promotedAvgReturnPct).toBeNull();
    expect(result.learningAddedValuePct).toBeNull();
    expect(result.hasMinimumEvidence).toBe(false);
  });

  it("a negative learningAddedValuePct correctly indicates promoted candidates underperformed demoted ones — supporting the noise/multiple-comparisons concern rather than disproving it", async () => {
    const { mock } = makeMockSupabase([
      { rank_delta: 1, hypothetical_return_pct: -5 },
      { rank_delta: -1, hypothetical_return_pct: 10 },
    ]);
    const result = await computeLearningAttribution(mock, "user-1");
    expect(result.learningAddedValuePct).toBeLessThan(0);
  });

  it("hasMinimumEvidence is false below the 30-sample floor on either side", async () => {
    const rows = [
      ...Array.from({ length: 25 }, () => ({ rank_delta: 1, hypothetical_return_pct: 1 })),
      ...Array.from({ length: 35 }, () => ({ rank_delta: -1, hypothetical_return_pct: 1 })),
    ];
    const { mock } = makeMockSupabase(rows);
    const result = await computeLearningAttribution(mock, "user-1");
    expect(result.promotedSampleSize).toBe(25);
    expect(result.demotedSampleSize).toBe(35);
    expect(result.hasMinimumEvidence).toBe(false); // 25 < 30 on the promoted side
  });

  it("hasMinimumEvidence is true once both promoted and demoted reach the 30-sample floor", async () => {
    const rows = [
      ...Array.from({ length: 30 }, () => ({ rank_delta: 1, hypothetical_return_pct: 1 })),
      ...Array.from({ length: 30 }, () => ({ rank_delta: -1, hypothetical_return_pct: 1 })),
    ];
    const { mock } = makeMockSupabase(rows);
    const result = await computeLearningAttribution(mock, "user-1");
    expect(result.hasMinimumEvidence).toBe(true);
  });

  it("rank_delta of exactly 0 is correctly excluded from both promoted and demoted groups", async () => {
    const { mock } = makeMockSupabase([{ rank_delta: 0, hypothetical_return_pct: 5 }]);
    const result = await computeLearningAttribution(mock, "user-1");
    expect(result.promotedSampleSize).toBe(0);
    expect(result.demotedSampleSize).toBe(0);
    expect(result.neutralSampleSize).toBe(1);
  });
});

describe("computeLearningAttribution — data-quality exclusion", () => {
  it("filters out rows flagged by the resolution data-quality screen", async () => {
    const { mock, filters } = makeMockSupabase([{ rank_delta: 1, hypothetical_return_pct: 4 }]);
    await computeLearningAttribution(mock, "user-1");
    expect(filters).toContainEqual(["data_quality_flag", false]);
  });
});
