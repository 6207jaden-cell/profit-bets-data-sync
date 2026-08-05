import { describe, it, expect } from "vitest";
import { computePortfolioAttribution } from "@/lib/portfolio-attribution";

function makeMockSupabase(trades: Array<{ pnl: number; asset: string; instrument: string | null }>) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: boolean) => ({
            not: async (_col3: string, _op: string, _val3: unknown) => ({ data: trades, error: null }),
          }),
        }),
      }),
    }),
  } as any;
}

describe("computePortfolioAttribution", () => {
  it("computes the correct hand-verified attribution by symbol and asset class", async () => {
    // AAPL (stock): +100, -20 -> total 80, 2 trades
    // BTC-USD (crypto): +50 -> total 50, 1 trade
    // NVDA call (options): -10 -> total -10, 1 trade
    // Grand total = 80+50-10 = 120
    const mock = makeMockSupabase([
      { pnl: 100, asset: "AAPL", instrument: "stock" },
      { pnl: -20, asset: "AAPL", instrument: "stock" },
      { pnl: 50, asset: "BTC-USD", instrument: "crypto" },
      { pnl: -10, asset: "NVDA", instrument: "call" },
    ]);
    const result = await computePortfolioAttribution(mock, "user-1");
    expect(result.totalPnlDollar).toBeCloseTo(120, 2);
    expect(result.tradeCount).toBe(4);

    const aapl = result.bySymbol.find((r) => r.symbol === "AAPL")!;
    expect(aapl.totalPnlDollar).toBeCloseTo(80, 2);
    expect(aapl.tradeCount).toBe(2);
    expect(aapl.pctOfTotalPnl).toBeCloseTo(66.7, 1);

    const stock = result.byAssetClass.find((r) => r.assetClass === "stock")!;
    expect(stock.totalPnlDollar).toBeCloseTo(80, 2);
    const crypto = result.byAssetClass.find((r) => r.assetClass === "crypto")!;
    expect(crypto.totalPnlDollar).toBeCloseTo(50, 2);
    const options = result.byAssetClass.find((r) => r.assetClass === "options")!;
    expect(options.totalPnlDollar).toBeCloseTo(-10, 2);
  });

  it("percentages by asset class sum to exactly 100% (a true partition) — the deliberate contrast to Signal Attribution's >100% credit-sharing", async () => {
    const mock = makeMockSupabase([
      { pnl: 100, asset: "AAPL", instrument: "stock" },
      { pnl: 50, asset: "BTC-USD", instrument: "crypto" },
      { pnl: -30, asset: "NVDA", instrument: "call" },
    ]);
    const result = await computePortfolioAttribution(mock, "user-1");
    const sumByAssetClass = result.byAssetClass.reduce((s, r) => s + (r.pctOfTotalPnl ?? 0), 0);
    const sumBySymbol = result.bySymbol.reduce((s, r) => s + (r.pctOfTotalPnl ?? 0), 0);
    expect(sumByAssetClass).toBeCloseTo(100, 0);
    expect(sumBySymbol).toBeCloseTo(100, 0);
  });

  it("correctly classifies every documented instrument type into the right asset class", async () => {
    const mock = makeMockSupabase([
      { pnl: 1, asset: "A", instrument: "stock" },
      { pnl: 1, asset: "B", instrument: "etf" },
      { pnl: 1, asset: "C", instrument: "crypto" },
      { pnl: 1, asset: "D", instrument: "call" },
      { pnl: 1, asset: "E", instrument: "put" },
      { pnl: 1, asset: "F", instrument: "call_spread" },
      { pnl: 1, asset: "G", instrument: "put_spread" },
    ]);
    const result = await computePortfolioAttribution(mock, "user-1");
    const classes = new Set(result.byAssetClass.map((r) => r.assetClass));
    expect(classes.has("stock")).toBe(true);
    expect(classes.has("etf")).toBe(true);
    expect(classes.has("crypto")).toBe(true);
    const optionsRow = result.byAssetClass.find((r) => r.assetClass === "options")!;
    expect(optionsRow.tradeCount).toBe(4);
  });

  it("defaults a null/missing instrument to 'stock', matching the same fallback used elsewhere in this project (e.g. estimateFees)", async () => {
    const mock = makeMockSupabase([{ pnl: 10, asset: "AAPL", instrument: null }]);
    const result = await computePortfolioAttribution(mock, "user-1");
    expect(result.byAssetClass.find((r) => r.assetClass === "stock")).toBeDefined();
  });

  it("returns pctOfTotalPnl: null when total P&L is exactly zero", async () => {
    const mock = makeMockSupabase([
      { pnl: 50, asset: "AAPL", instrument: "stock" },
      { pnl: -50, asset: "AAPL", instrument: "stock" },
    ]);
    const result = await computePortfolioAttribution(mock, "user-1");
    expect(result.totalPnlDollar).toBe(0);
    expect(result.bySymbol[0].pctOfTotalPnl).toBeNull();
  });

  it("sorts both breakdowns by total dollar P&L, largest first", async () => {
    const mock = makeMockSupabase([
      { pnl: 10, asset: "SMALL", instrument: "stock" },
      { pnl: 1000, asset: "BIG", instrument: "stock" },
    ]);
    const result = await computePortfolioAttribution(mock, "user-1");
    expect(result.bySymbol[0].symbol).toBe("BIG");
  });

  it("returns empty arrays and zero totals for no closed trades", async () => {
    const mock = makeMockSupabase([]);
    const result = await computePortfolioAttribution(mock, "user-1");
    expect(result.bySymbol).toEqual([]);
    expect(result.byAssetClass).toEqual([]);
    expect(result.totalPnlDollar).toBe(0);
  });
});
