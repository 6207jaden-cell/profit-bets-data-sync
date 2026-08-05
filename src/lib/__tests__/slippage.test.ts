import { describe, it, expect } from "vitest";
import { estimateSlippageBps, applySlippage } from "@/lib/slippage";

describe("estimateSlippageBps", () => {
  it("computes the correct hand-verified bps for a highly-liquid stock, small order", () => {
    // avgDailyDollarVolume = 1,000,000 shares * $100 = $100M -> "highly liquid" tier (1.0x)
    // baseSpreadBps = 2 (stock), participationRate = 10,000/100,000,000 = 0.0001
    // impactBps = 15*sqrt(0.0001) = 0.15
    // total = 2*1.0 + 0.15 = 2.15
    const result = estimateSlippageBps({ orderNotional: 10_000, avgDailyVolume: 1_000_000, price: 100, isCrypto: false });
    expect(result.slippageBps).toBeCloseTo(2.15, 1);
  });

  it("computes the correct hand-verified bps for crypto with unknown volume", () => {
    // Unknown volume + crypto -> liquidityMultiplier 2.5, baseSpreadBps 6, default participationRate 0.01
    // impactBps = 15*sqrt(0.01) = 1.5 -> total = 6*2.5 + 1.5 = 16.5
    const result = estimateSlippageBps({ orderNotional: 5000, avgDailyVolume: null, price: 50, isCrypto: true });
    expect(result.slippageBps).toBeCloseTo(16.5, 1);
  });

  it("computes the correct hand-verified bps for a very thin stock with a large relative order", () => {
    // avgDailyDollarVolume = 10,000 * $10 = $100,000 -> "very thin" tier (6.0x)
    // participationRate = 50,000/100,000 = 0.5 -> impactBps = 15*sqrt(0.5) ≈ 10.6066
    // total = 2*6.0 + 10.6066 ≈ 22.6066
    const result = estimateSlippageBps({ orderNotional: 50_000, avgDailyVolume: 10_000, price: 10, isCrypto: false });
    expect(result.slippageBps).toBeCloseTo(22.61, 1);
  });

  it("charges crypto a higher base cost than stocks at identical liquidity and order size", () => {
    const stockResult = estimateSlippageBps({ orderNotional: 10_000, avgDailyVolume: 1_000_000, price: 100, isCrypto: false });
    const cryptoResult = estimateSlippageBps({ orderNotional: 10_000, avgDailyVolume: 1_000_000, price: 100, isCrypto: true });
    expect(cryptoResult.slippageBps).toBeGreaterThan(stockResult.slippageBps);
  });

  it("caps slippage at 300bps (3%) even for an extreme participation rate", () => {
    const result = estimateSlippageBps({ orderNotional: 10_000_000, avgDailyVolume: 100, price: 1, isCrypto: true });
    expect(result.slippageBps).toBeLessThanOrEqual(300);
  });

  it("larger orders (relative to volume) cost more, but sub-linearly (sqrt model) — 4x size costs ~2x impact, not 4x", () => {
    // Uses avgDailyVolume=2,000,000 (not 1,000,000) specifically to avoid a
    // participation rate that lands on a .X5 boundary, which previously
    // triggered a floating-point .toFixed(1) rounding artifact (2.15 rounds
    // down to 2.1 in IEEE754) that made this assertion flaky even though
    // the underlying pre-rounding math was exactly correct. Testing the
    // relationship, not fighting output rounding.
    const base = estimateSlippageBps({ orderNotional: 10_000, avgDailyVolume: 2_000_000, price: 100, isCrypto: false });
    const quadruple = estimateSlippageBps({ orderNotional: 40_000, avgDailyVolume: 2_000_000, price: 100, isCrypto: false });
    const baseImpactPortion = base.slippageBps - 2;
    const quadImpactPortion = quadruple.slippageBps - 2;
    expect(quadImpactPortion).toBeCloseTo(baseImpactPortion * 2, 1);
  });
});

describe("applySlippage", () => {
  it("makes a buy fill cost MORE than the quoted price (adverse)", () => {
    const filled = applySlippage(100, "buy", 50); // 50bps = 0.5%
    expect(filled).toBeCloseTo(100.5, 5);
  });

  it("makes a sell fill receive LESS than the quoted price (adverse)", () => {
    const filled = applySlippage(100, "sell", 50);
    expect(filled).toBeCloseTo(99.5, 5);
  });

  it("zero slippage leaves the price unchanged", () => {
    expect(applySlippage(123.45, "buy", 0)).toBeCloseTo(123.45, 5);
    expect(applySlippage(123.45, "sell", 0)).toBeCloseTo(123.45, 5);
  });
});
