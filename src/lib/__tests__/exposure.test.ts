import { describe, it, expect } from "vitest";
import { computeExposure } from "@/lib/exposure";

function makeMockSupabase(
  portfolio: { balance: number; equity: number } | null,
  openTrades: Array<{ quantity: number; entry_price: number; asset: string; instrument: string | null }>,
) {
  return {
    from: (table: string) => {
      if (table === "paper_portfolios") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: portfolio, error: null }),
            }),
          }),
        };
      }
      // paper_trades — matches computeExposure's actual query shape:
      // .eq("user_id", ...).eq("is_open", true) with no chained call after,
      // so the second .eq() itself must be awaitable.
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: openTrades, error: null }),
          }),
        }),
      };
    },
  } as any;
}

describe("computeExposure", () => {
  it("computes the correct hand-verified cash/deployed split and HHI concentration for a known portfolio", async () => {
    // Portfolio: equity=5000, balance(cash)=3000
    // 3 positions: value 1000 (stock), 500 (crypto), 500 (stock) -> deployed = 2000
    // largest = 1000, largestPositionPct = 1000/2000*100 = 50%
    // shares: 50%, 25%, 25% -> HHI = 2500+625+625 = 3750
    // cashPct = 3000/5000*100 = 60%, deployedPct = 2000/5000*100 = 40%
    const mock = makeMockSupabase(
      { balance: 3000, equity: 5000 },
      [
        { quantity: 10, entry_price: 100, asset: "AAPL", instrument: "stock" }, // 1000
        { quantity: 5, entry_price: 100, asset: "BTC-USD", instrument: "crypto" }, // 500
        { quantity: 5, entry_price: 100, asset: "MSFT", instrument: "stock" }, // 500
      ],
    );
    const result = await computeExposure(mock, "user-1");
    expect(result).not.toBeNull();
    expect(result!.totalEquity).toBeCloseTo(5000, 2);
    expect(result!.cashBalance).toBeCloseTo(3000, 2);
    expect(result!.deployedValue).toBeCloseTo(2000, 2);
    expect(result!.cashPct).toBeCloseTo(60, 1);
    expect(result!.deployedPct).toBeCloseTo(40, 1);
    expect(result!.largestPositionPct).toBeCloseTo(50, 1);
    expect(result!.concentrationHHI).toBeCloseTo(3750, 0);
    expect(result!.openPositionCount).toBe(3);
  });

  it("computes exact HHI=10000 (maximum concentration) for a single position holding all deployed capital", async () => {
    const mock = makeMockSupabase(
      { balance: 0, equity: 1000 },
      [{ quantity: 10, entry_price: 100, asset: "AAPL", instrument: "stock" }],
    );
    const result = await computeExposure(mock, "user-1");
    expect(result!.concentrationHHI).toBe(10000);
    expect(result!.largestPositionPct).toBe(100);
  });

  it("returns HHI approaching a low value for many equally-sized positions (diversified)", async () => {
    // 10 equal positions -> each share = 10%, HHI = 10 * 10^2 = 1000
    const positions = Array.from({ length: 10 }, (_, i) => ({
      quantity: 1, entry_price: 100, asset: `SYM${i}`, instrument: "stock",
    }));
    const mock = makeMockSupabase({ balance: 0, equity: 1000 }, positions);
    const result = await computeExposure(mock, "user-1");
    expect(result!.concentrationHHI).toBeCloseTo(1000, 0);
  });

  it("returns null largestPositionPct and null concentrationHHI when there are no open positions", async () => {
    const mock = makeMockSupabase({ balance: 5000, equity: 5000 }, []);
    const result = await computeExposure(mock, "user-1");
    expect(result!.largestPositionPct).toBeNull();
    expect(result!.concentrationHHI).toBeNull();
    expect(result!.deployedValue).toBe(0);
    expect(result!.cashPct).toBe(100);
  });

  it("groups exposure by asset class correctly", async () => {
    const mock = makeMockSupabase(
      { balance: 0, equity: 1500 },
      [
        { quantity: 10, entry_price: 100, asset: "AAPL", instrument: "stock" }, // 1000
        { quantity: 5, entry_price: 100, asset: "BTC-USD", instrument: "crypto" }, // 500
      ],
    );
    const result = await computeExposure(mock, "user-1");
    const stock = result!.byAssetClass.find((r) => r.assetClass === "stock")!;
    const crypto = result!.byAssetClass.find((r) => r.assetClass === "crypto")!;
    expect(stock.pctOfDeployed).toBeCloseTo(66.7, 1);
    expect(crypto.pctOfDeployed).toBeCloseTo(33.3, 1);
  });

  it("returns null when the user has no portfolio row at all", async () => {
    const mock = makeMockSupabase(null, []);
    const result = await computeExposure(mock, "user-1");
    expect(result).toBeNull();
  });
});
