import { describe, it, expect } from "vitest";
import { isValidAiTrade, filterValidAiTrades, type AiTradeShape } from "@/lib/ai-response-validation";

function validTrade(overrides: Partial<AiTradeShape> = {}): unknown {
  return {
    symbol: "AAPL",
    direction: "long",
    instrument: "stock",
    conviction: 75,
    allocation_pct: 5,
    stop_loss_pct: 3,
    take_profit_pct: 6,
    hold_duration: "swing",
    rationale: "Strong momentum signal.",
    ...overrides,
  };
}

describe("isValidAiTrade", () => {
  it("accepts a well-formed trade proposal", () => {
    expect(isValidAiTrade(validTrade())).toBe(true);
  });

  it("rejects null, undefined, and non-object values rather than throwing", () => {
    expect(isValidAiTrade(null)).toBe(false);
    expect(isValidAiTrade(undefined)).toBe(false);
    expect(isValidAiTrade("not an object")).toBe(false);
    expect(isValidAiTrade(42)).toBe(false);
    expect(isValidAiTrade([])).toBe(false);
  });

  it("rejects a missing or non-string symbol — the exact field that would throw on .toUpperCase() downstream", () => {
    expect(isValidAiTrade(validTrade({ symbol: undefined as unknown as string }))).toBe(false);
    expect(isValidAiTrade(validTrade({ symbol: null as unknown as string }))).toBe(false);
    expect(isValidAiTrade(validTrade({ symbol: 123 as unknown as string }))).toBe(false);
    expect(isValidAiTrade(validTrade({ symbol: "" }))).toBe(false);
    expect(isValidAiTrade(validTrade({ symbol: "   " }))).toBe(false);
  });

  it("rejects a direction that isn't exactly 'long' or 'short'", () => {
    expect(isValidAiTrade(validTrade({ direction: "buy" as unknown as "long" }))).toBe(false);
    expect(isValidAiTrade(validTrade({ direction: undefined as unknown as "long" }))).toBe(false);
  });

  it("rejects a missing or empty instrument string", () => {
    expect(isValidAiTrade(validTrade({ instrument: "" }))).toBe(false);
    expect(isValidAiTrade(validTrade({ instrument: undefined as unknown as string }))).toBe(false);
  });

  it("rejects non-finite conviction (NaN, Infinity, non-number)", () => {
    expect(isValidAiTrade(validTrade({ conviction: NaN }))).toBe(false);
    expect(isValidAiTrade(validTrade({ conviction: Infinity }))).toBe(false);
    expect(isValidAiTrade(validTrade({ conviction: "75" as unknown as number }))).toBe(false);
  });

  it("rejects a non-positive allocation_pct — zero or negative allocation is never a valid trade instruction", () => {
    expect(isValidAiTrade(validTrade({ allocation_pct: 0 }))).toBe(false);
    expect(isValidAiTrade(validTrade({ allocation_pct: -5 }))).toBe(false);
  });

  it("rejects a non-positive stop_loss_pct — zero or negative would make Average R math divide incorrectly downstream", () => {
    expect(isValidAiTrade(validTrade({ stop_loss_pct: 0 }))).toBe(false);
    expect(isValidAiTrade(validTrade({ stop_loss_pct: -3 }))).toBe(false);
  });

  it("rejects a hold_duration outside the three valid values", () => {
    expect(isValidAiTrade(validTrade({ hold_duration: "long_term" as unknown as "swing" }))).toBe(false);
  });

  it("rejects a missing or non-string rationale", () => {
    expect(isValidAiTrade(validTrade({ rationale: undefined as unknown as string }))).toBe(false);
  });

  it("accepts a trade with options_details omitted — it's genuinely optional", () => {
    const { options_details, ...withoutOptionsDetails } = validTrade() as AiTradeShape;
    expect(isValidAiTrade(withoutOptionsDetails)).toBe(true);
  });
});

describe("filterValidAiTrades", () => {
  it("keeps every valid trade and drops every malformed one, preserving order", () => {
    const trades = [
      validTrade({ symbol: "AAPL" }),
      { symbol: null, direction: "long" }, // malformed
      validTrade({ symbol: "MSFT" }),
    ];
    const result = filterValidAiTrades(trades);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("returns an empty array, not a throw, when every trade is malformed", () => {
    const trades = [null, undefined, { symbol: 123 }, "not a trade"];
    expect(filterValidAiTrades(trades)).toEqual([]);
  });

  it("returns an empty array for an empty input array", () => {
    expect(filterValidAiTrades([])).toEqual([]);
  });

  it("one malformed trade does not prevent the other valid trades in the same batch from being kept — the actual bug this fixes", () => {
    const trades = [
      validTrade({ symbol: "GOOD1" }),
      { totally: "malformed", missing: "everything" },
      validTrade({ symbol: "GOOD2" }),
      validTrade({ symbol: "GOOD3" }),
    ];
    const result = filterValidAiTrades(trades);
    expect(result).toHaveLength(3);
  });
});
