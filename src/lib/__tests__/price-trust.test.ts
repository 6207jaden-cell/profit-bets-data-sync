import { describe, it, expect } from "vitest";
import {
  PRICE_AGREEMENT_MAX_PCT,
  pctDifference,
  pricesAgree,
  isImplausibleVsReference,
  selectTrustedPrice,
  type QuoteCandidate,
} from "@/lib/indicators";
import { IMPLAUSIBLE_RETURN_PCT, returnPctOfNotional, isImplausibleReturn } from "@/lib/data-quality";

function c(source: string, price: number, freshnessVerified = false): QuoteCandidate {
  return { source, price, freshnessVerified };
}

describe("pctDifference / pricesAgree", () => {
  it("computes a symmetric percentage difference relative to the mean", () => {
    expect(pctDifference(100, 100)).toBe(0);
    expect(pctDifference(100, 110)).toBeCloseTo(9.5238, 3);
    expect(pctDifference(110, 100)).toBeCloseTo(9.5238, 3);
  });

  it("treats prices within the agreement threshold as agreeing and beyond it as disagreeing", () => {
    expect(pricesAgree(100, 105)).toBe(true);
    expect(pricesAgree(100, 500)).toBe(false);
    expect(PRICE_AGREEMENT_MAX_PCT).toBe(15);
  });
});

describe("isImplausibleVsReference", () => {
  it("accepts a large but real move", () => {
    // +80% in a day is extreme but possible; it must NOT be rejected.
    expect(isImplausibleVsReference(180, 100)).toBe(false);
  });

  it("rejects an order-of-magnitude departure in either direction", () => {
    expect(isImplausibleVsReference(6000, 100)).toBe(true);
    expect(isImplausibleVsReference(1, 100)).toBe(true);
  });

  it("cannot judge without a reference, so it does not reject", () => {
    expect(isImplausibleVsReference(6000, null)).toBe(false);
    expect(isImplausibleVsReference(6000, undefined)).toBe(false);
    expect(isImplausibleVsReference(6000, 0)).toBe(false);
  });

  it("treats a non-positive price as implausible when a reference exists", () => {
    expect(isImplausibleVsReference(0, 100)).toBe(true);
    expect(isImplausibleVsReference(-5, 100)).toBe(true);
  });
});

describe("selectTrustedPrice", () => {
  it("rejects the corruption signature: a wildly wrong single quote against a known reference", () => {
    const result = selectTrustedPrice([c("yahoo", 5000)], 100);
    expect(result.price).toBeNull();
    expect(result.reason).toContain("implausible vs reference");
  });

  it("trusts a quote corroborated by the reference price", () => {
    const result = selectTrustedPrice([c("yahoo", 102)], 100);
    expect(result.price).toBe(102);
    expect(result.source).toBe("yahoo");
  });

  it("trusts two independent sources that agree, even with no reference", () => {
    const result = selectTrustedPrice([c("yahoo", 100), c("finnhub", 103, true)], null);
    expect(result.price).toBe(103); // the freshness-verified one wins
    expect(result.source).toBe("finnhub");
  });

  it("rejects a single uncorroborated source whose freshness could not be verified", () => {
    const result = selectTrustedPrice([c("yahoo", 100, false)], null);
    expect(result.price).toBeNull();
    expect(result.reason).toContain("not trusted");
  });

  it("trusts a single source when its freshness WAS verified", () => {
    const result = selectTrustedPrice([c("finnhub", 100, true)], null);
    expect(result.price).toBe(100);
  });

  it("rejects two sources that disagree wildly and neither matches the reference", () => {
    const result = selectTrustedPrice([c("yahoo", 100), c("polygon", 140)], 400);
    // 100 and 140 both survive the 5x reference screen, disagree by >15%,
    // neither corroborated by the reference, neither freshness-verified.
    expect(result.price).toBeNull();
  });

  it("ignores zero/negative/non-finite quotes entirely", () => {
    const result = selectTrustedPrice([c("a", 0), c("b", -1), c("c", NaN)], 100);
    expect(result.price).toBeNull();
    expect(result.reason).toContain("no usable quote");
  });
});

describe("data-quality return screen", () => {
  it("computes return on notional", () => {
    expect(returnPctOfNotional(50, 100, 5)).toBeCloseTo(10, 6);
    expect(returnPctOfNotional(-50, 100, 5)).toBeCloseTo(-10, 6);
  });

  it("returns null when notional is unknown or zero rather than guessing", () => {
    expect(returnPctOfNotional(50, 0, 5)).toBeNull();
    expect(returnPctOfNotional(50, 100, 0)).toBeNull();
    expect(returnPctOfNotional(null, 100, 5)).toBeNull();
  });

  it("flags only returns beyond ±100% of notional", () => {
    expect(IMPLAUSIBLE_RETURN_PCT).toBe(100);
    expect(isImplausibleReturn(99, 100, 1)).toBe(false);
    expect(isImplausibleReturn(100, 100, 1)).toBe(false); // exactly at the boundary is kept
    expect(isImplausibleReturn(101, 100, 1)).toBe(true);
    expect(isImplausibleReturn(-250, 100, 1)).toBe(true);
  });

  it("does not flag when it cannot compute a return", () => {
    expect(isImplausibleReturn(5000, 0, 0)).toBe(false);
  });
});
