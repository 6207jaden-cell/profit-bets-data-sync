import { describe, it, expect } from "vitest";
import { classify, matchesFinancialKeyword } from "@/lib/market.functions";
import { sentimentScore } from "@/lib/catalysts.functions";

describe("matchesFinancialKeyword", () => {
  it("matches a keyword that appears as its own word", () => {
    expect(matchesFinancialKeyword("stock surges today", "surge")).toBe(false); // "surges" != "surge" without the explicit inflected form
    expect(matchesFinancialKeyword("stock surge today", "surge")).toBe(true);
  });

  it("does NOT match a keyword embedded inside a larger, unrelated word — the exact bug this fixes", () => {
    expect(matchesFinancialKeyword("bargain stocks amid selloff", "gain")).toBe(false);
    expect(matchesFinancialKeyword("cutting-edge product", "cut")).toBe(false);
    expect(matchesFinancialKeyword("surprise earnings", "rise")).toBe(false);
    expect(matchesFinancialKeyword("enterprise software firm", "rise")).toBe(false);
  });

  it("is not case-sensitive by itself — classify() lowercases first, this just checks the boundary logic", () => {
    expect(matchesFinancialKeyword("Company Beat Estimates", "beat")).toBe(false); // classify() lowercases before calling this
    expect(matchesFinancialKeyword("company beat estimates", "beat")).toBe(true);
  });
});

describe("classify", () => {
  it("classifies genuine bullish keywords correctly, including inflected forms with real spelling changes", () => {
    expect(classify("Stock surges on earnings beat")).toBe("bullish");
    expect(classify("Shares rallied after the announcement")).toBe("bullish"); // rally -> rallied (y->ied), not a simple suffix
    expect(classify("Prices jumped sharply")).toBe("bullish");
    expect(classify("Stock price is rising today")).toBe("bullish"); // rise -> rising (e-drop), not a simple suffix
  });

  it("classifies genuine bearish keywords correctly, including inflected forms", () => {
    expect(classify("Company warned of a slowdown")).toBe("bearish");
    expect(classify("Analysts are concerned")).toBe("bearish");
    expect(classify("Shares fell after the report")).toBe("bearish");
    expect(classify("Stock plunged on the news")).toBe("bearish");
  });

  it("does NOT misclassify 'bargain' as bullish via a false match on 'gain' — real headline shape, was broken before this fix", () => {
    expect(classify("Investors find bargain stocks amid broader market selloff")).not.toBe("bullish");
  });

  it("does NOT misclassify a 'cutting-edge' headline as bearish via a false match on 'cut'", () => {
    expect(classify("Company unveils cutting-edge product, stock surges")).toBe("bullish"); // should be bullish from "surges" alone, not diluted by a false "cut" match
  });

  it("does NOT misclassify 'surprise'/'enterprise' headlines via a false match on 'rise'", () => {
    expect(classify("Company reports surprise earnings miss")).toBe("bearish"); // should be bearish from the genuine "miss" match, not neutralized by a false "rise" match
  });

  it("no longer scores 'record' as unconditionally bullish — financial news uses it for both record highs AND record lows/losses", () => {
    // "record" was removed entirely from the bull list rather than special-cased,
    // since a keyword-count classifier has no way to tell "record high" from
    // "record low" apart without deeper context.
    expect(classify("Company reports record quarterly losses")).not.toBe("bullish");
    expect(classify("Stock hits record low amid selling pressure")).not.toBe("bullish");
  });

  it("returns neutral for text with no financial sentiment keywords", () => {
    expect(classify("Company announces new product lineup")).toBe("neutral");
  });

  it("returns neutral when bullish and bearish keyword counts exactly tie", () => {
    expect(classify("Stock beat estimates but shares fell on guidance")).toBe("neutral");
  });
});

describe("catalysts.functions.ts's sentimentScore (a separate, more consequential implementation with the same bug, fixed the same way)", () => {
  it("does NOT misclassify 'bargain' via a false match on 'gain' — same bug, different file", () => {
    const score = sentimentScore("Investors find bargain stocks amid broader market selloff");
    expect(score).toBeLessThanOrEqual(0);
  });

  it("no longer scores 'record' as bullish — same ambiguity fix as market.functions.ts", () => {
    expect(sentimentScore("Company reports record quarterly losses")).toBeLessThanOrEqual(0);
  });

  it("correctly scores a genuinely positive catalyst headline", () => {
    expect(sentimentScore("Company announces major partnership and stock surges")).toBeGreaterThan(0);
  });

  it("correctly scores a genuinely negative catalyst headline, including the extra bear keywords unique to this file", () => {
    expect(sentimentScore("Regulators launch a probe into the company amid bankruptcy fears")).toBeLessThan(0);
  });

  it("returns a score clamped to the -1..1 range even with many keyword matches", () => {
    const extreme = sentimentScore("surge surge surge surge surge surge surge surge surge surge");
    expect(extreme).toBeLessThanOrEqual(1);
    expect(extreme).toBeGreaterThanOrEqual(-1);
  });
});
