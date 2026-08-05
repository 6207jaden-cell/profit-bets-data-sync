import { describe, it, expect } from "vitest";
import { logShadowCandidates } from "@/lib/shadow-experiments";

/**
 * Minimal mock of the Supabase admin client's .from().insert() chain,
 * capturing every row that would have been inserted so the classification
 * LOGIC can be validated without real database I/O. This is a legitimate,
 * standard way to test a DB-writing function's decision logic in
 * isolation — the actual insert plumbing (already exercised in production
 * since commit 784852f) is not what these tests are checking.
 */
function makeMockSupabase() {
  const insertedRows: Array<Record<string, unknown>> = [];
  const mock = {
    from: (_table: string) => ({
      insert: async (rows: Array<Record<string, unknown>>) => {
        insertedRows.push(...rows);
        return { data: rows, error: null };
      },
    }),
  };
  return { mock: mock as any, insertedRows };
}

describe("logShadowCandidates — agreement classification", () => {
  it("classifies a top-6 candidate that Claude traded as agree_traded", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    await logShadowCandidates(
      mock,
      "user-1",
      "morning_scan",
      [{ symbol: "AAPL", bull_score: 50, bear_score: 5, direction_hint: "long", price: 100 }],
      [{ symbol: "AAPL", direction: "long", conviction: 80 }],
    );
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].agreement).toBe("agree_traded");
    expect(insertedRows[0].claude_traded).toBe(true);
    expect(insertedRows[0].deterministic_rank).toBe(1);
  });

  it("classifies a top-6 candidate Claude did NOT trade as disagree_claude_skipped", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    await logShadowCandidates(
      mock, "user-1", "morning_scan",
      [{ symbol: "AAPL", bull_score: 50, bear_score: 5, direction_hint: "long", price: 100 }],
      [],
    );
    expect(insertedRows[0].agreement).toBe("disagree_claude_skipped");
    expect(insertedRows[0].claude_traded).toBe(false);
  });

  it("classifies a below-top-6 candidate Claude traded anyway as disagree_claude_added", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      symbol: `SYM${i}`, bull_score: 50 - i, bear_score: 5, direction_hint: "long", price: 100,
    }));
    await logShadowCandidates(
      mock, "user-1", "morning_scan", candidates,
      [{ symbol: "SYM6", direction: "long", conviction: 90 }],
    );
    const row = insertedRows.find((r) => r.symbol === "SYM6")!;
    expect(row.deterministic_rank).toBe(7);
    expect(row.agreement).toBe("disagree_claude_added");
  });

  it("classifies a below-top-6 candidate Claude also skipped as agree_skipped", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      symbol: `SYM${i}`, bull_score: 50 - i, bear_score: 5, direction_hint: "long", price: 100,
    }));
    await logShadowCandidates(mock, "user-1", "morning_scan", candidates, []);
    const row = insertedRows.find((r) => r.symbol === "SYM6")!;
    expect(row.agreement).toBe("agree_skipped");
  });

  it("handles case-insensitive symbol matching between candidates and Claude's trades", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    await logShadowCandidates(
      mock, "user-1", "morning_scan",
      [{ symbol: "aapl", bull_score: 50, bear_score: 5, direction_hint: "long", price: 100 }],
      [{ symbol: "AAPL", direction: "long", conviction: 80 }],
    );
    expect(insertedRows[0].agreement).toBe("agree_traded");
  });

  it("defaults an 'unclear' direction hint to long for the stored deterministic_direction", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    await logShadowCandidates(
      mock, "user-1", "morning_scan",
      [{ symbol: "AAPL", bull_score: 20, bear_score: 18, direction_hint: "unclear", price: 100 }],
      [],
    );
    expect(insertedRows[0].deterministic_direction).toBe("long");
  });

  it("is a no-op (no insert calls) when given an empty candidate list", async () => {
    const { mock, insertedRows } = makeMockSupabase();
    await logShadowCandidates(mock, "user-1", "morning_scan", [], []);
    expect(insertedRows).toHaveLength(0);
  });

  it("never throws even if the underlying insert fails — logging must not break real trading", async () => {
    const throwingMock = { from: () => ({ insert: async () => { throw new Error("simulated DB failure"); } }) };
    await expect(
      logShadowCandidates(throwingMock as any, "user-1", "morning_scan",
        [{ symbol: "AAPL", bull_score: 10, bear_score: 0, direction_hint: "long" }], []),
    ).resolves.not.toThrow();
  });
});
