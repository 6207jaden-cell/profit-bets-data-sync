import { describe, it, expect } from "vitest";
import { normalizeSymbol, isCryptoSymbol, cryptoBase } from "@/lib/indicators";

describe("normalizeSymbol", () => {
  it("converts slash pairs to the canonical dash form", () => {
    expect(normalizeSymbol("ETH/USD")).toBe("ETH-USD");
    expect(normalizeSymbol("sol/usd")).toBe("SOL-USD");
    expect(normalizeSymbol("BTC/USDT")).toBe("BTC-USD");
    expect(normalizeSymbol("ETH/USDC")).toBe("ETH-USD");
  });

  it("expands bare crypto tickers to USD pairs", () => {
    expect(normalizeSymbol("BTC")).toBe("BTC-USD");
    expect(normalizeSymbol("eth")).toBe("ETH-USD");
    expect(normalizeSymbol("DOGE")).toBe("DOGE-USD");
  });

  it("resolves common coin names", () => {
    expect(normalizeSymbol("Bitcoin")).toBe("BTC-USD");
    expect(normalizeSymbol("ethereum")).toBe("ETH-USD");
    expect(normalizeSymbol("Solana")).toBe("SOL-USD");
  });

  it("leaves equity and ETF tickers alone", () => {
    expect(normalizeSymbol("NVDA")).toBe("NVDA");
    expect(normalizeSymbol("spy")).toBe("SPY");
    expect(normalizeSymbol(" aapl ")).toBe("AAPL");
  });

  it("is idempotent and safe on empty input", () => {
    expect(normalizeSymbol(normalizeSymbol("ETH/USD"))).toBe("ETH-USD");
    expect(normalizeSymbol("")).toBe("");
  });

  it("produces symbols the crypto helpers recognize", () => {
    const s = normalizeSymbol("BTC");
    expect(isCryptoSymbol(s)).toBe(true);
    expect(cryptoBase(s)).toBe("BTC");
  });
});

describe("normalizeSymbol — ambiguous equity tickers", () => {
  it("leaves tickers that are also listed equities alone", () => {
    for (const t of ["STX", "CRV", "APT", "OP", "UNI", "LINK", "MKR", "ICP", "TIA", "SEI", "FET", "ETC", "ARB", "ATOM", "TON"]) {
      expect(normalizeSymbol(t)).toBe(t);
    }
  });
  it("still honours an explicit crypto pair for those bases", () => {
    expect(normalizeSymbol("UNI/USD")).toBe("UNI-USD");
    expect(normalizeSymbol("STX-USD")).toBe("STX-USD");
  });
});
