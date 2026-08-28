import { describe, it, expect } from "vitest";
import {
  isUniverseRestrictingAdjustment,
  sanitizeLearningAdjustments,
  sanitizeLearningAnalysis,
  LEARNING_SCOPE_INSTRUCTION,
} from "@/lib/learning-guardrails";

// These are the literal strings found in the live agent_learnings rows that
// caused the agent to stop trading stocks, ETFs and options entirely.
const REAL_POISONED = [
  "Continue to focus exclusively on crypto assets for scalp trades, as this strategy is proving highly effective and profitable.",
  "**IMMEDIATE FIX:** Implement a hard pre-trade filter at the absolute earliest stage of the trading pipeline to prevent *any* non-crypto assets from being considered for trade.",
  "The system appears to have successfully adhered to the 'LEARNED RULE 1' from Week 1 and the crypto-only focus from Week 2, as no stock or ETF trades were attempted.",
  "Only crypto trades are permitted going forward.",
  "Avoid stocks and ETFs entirely next week.",
];

const REAL_LEGITIMATE = [
  "Implement a clear stop-loss strategy for these scalp trades, even with a 100% win rate this week.",
  "Investigate if the current momentum-based entry signals (RSI, volume, breakouts) can be further optimized for earlier entry or larger position sizing.",
  "Monitor for potential market regime shifts and reduce size when breadth deteriorates.",
  "Tighten take-profit levels on swing positions held longer than five days.",
];

describe("isUniverseRestrictingAdjustment", () => {
  it("flags every universe-restricting string taken from the live data", () => {
    for (const s of REAL_POISONED) expect(isUniverseRestrictingAdjustment(s)).toBe(true);
  });

  it("leaves legitimate risk/sizing/timing advice alone", () => {
    for (const s of REAL_LEGITIMATE) expect(isUniverseRestrictingAdjustment(s)).toBe(false);
  });

  it("handles null, undefined and empty input without throwing", () => {
    expect(isUniverseRestrictingAdjustment(null)).toBe(false);
    expect(isUniverseRestrictingAdjustment(undefined)).toBe(false);
    expect(isUniverseRestrictingAdjustment("   ")).toBe(false);
  });
});

describe("sanitizeLearningAdjustments", () => {
  it("keeps the useful advice and drops only the universe bans", () => {
    const out = sanitizeLearningAdjustments([...REAL_POISONED, ...REAL_LEGITIMATE]);
    expect(out).toEqual(REAL_LEGITIMATE);
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeLearningAdjustments(null)).toEqual([]);
    expect(sanitizeLearningAdjustments("crypto only")).toEqual([]);
    expect(sanitizeLearningAdjustments(undefined)).toEqual([]);
  });

  it("trims and drops blank entries", () => {
    expect(sanitizeLearningAdjustments(["  ", "", "  Tighten stops.  "])).toEqual(["Tighten stops."]);
  });
});

describe("sanitizeLearningAnalysis", () => {
  it("removes only the offending sentence", () => {
    const input = "Win rate was 60% this week. All trades must be crypto only. Average hold was two days.";
    const out = sanitizeLearningAnalysis(input);
    expect(out).toContain("Win rate was 60% this week.");
    expect(out).toContain("Average hold was two days.");
    expect(out.toLowerCase()).not.toContain("crypto only");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeLearningAnalysis(null)).toBe("");
    expect(sanitizeLearningAnalysis("")).toBe("");
  });
});

describe("LEARNING_SCOPE_INSTRUCTION", () => {
  it("explicitly tells the reviewer all four asset classes stay in scope", () => {
    const s = LEARNING_SCOPE_INSTRUCTION.toLowerCase();
    for (const word of ["stock", "etf", "crypto", "option"]) expect(s).toContain(word);
  });
});
