/**
 * Multi-timeframe consensus using Polygon aggregates + our shared indicators.
 * Returns per-timeframe direction (bullish/bearish/neutral) based on SMA20 vs price and RSI14.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sma, rsi } from "@/lib/indicators";

type Verdict = "bullish" | "bearish" | "neutral";
type TfResult = { tf: string; label: string; verdict: Verdict; price: number; sma20: number; rsi14: number; changePct: number };

const TIMEFRAMES = [
  { tf: "5", label: "5m", unit: "minute", multiplier: 5, days: 1 },
  { tf: "60", label: "1h", unit: "hour", multiplier: 1, days: 7 },
  { tf: "D", label: "1D", unit: "day", multiplier: 1, days: 90 },
  { tf: "W", label: "1W", unit: "week", multiplier: 1, days: 365 },
] as const;

function isCrypto(s: string) {
  return /^(BTC|ETH|SOL|DOGE|ADA|XRP|AVAX|MATIC|BCH|DOT|LINK|SHIB|LTC|UNI|ATOM|BNB)(-USD)?$/i.test(s);
}

async function fetchAggs(sym: string, mult: number, unit: string, days: number, key: string): Promise<number[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/${mult}/${unit}/${from}/${to}?adjusted=true&sort=asc&limit=500&apiKey=${key}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = (await r.json()) as { results?: Array<{ c: number }> };
  return (j.results ?? []).map((x) => x.c);
}

function verdictFrom(price: number, smaVal: number, rsiVal: number): Verdict {
  const above = price > smaVal;
  if (above && rsiVal >= 50 && rsiVal < 70) return "bullish";
  if (!above && rsiVal <= 50 && rsiVal > 30) return "bearish";
  if (rsiVal >= 70) return "bearish"; // overbought
  if (rsiVal <= 30) return "bullish"; // oversold
  return "neutral";
}

export const getMultiTimeframeConsensus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ asset: z.string().min(1).max(15), assetType: z.enum(["stock", "crypto"]).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<
    | { available: true; asset: string; timeframes: TfResult[]; consensus: Verdict; score: number }
    | { available: false; reason: string }
  > => {
    const key = process.env.POLYGON_API_KEY;
    if (!key) return { available: false, reason: "missing_api_key" };
    const raw = data.asset.toUpperCase();
    const isCryptoSym = data.assetType === "crypto" || isCrypto(raw);
    const polySym = isCryptoSym ? `X:${raw.replace(/-?USD.*$/, "")}USD` : raw;

    const out: TfResult[] = [];
    for (const t of TIMEFRAMES) {
      try {
        const closes = await fetchAggs(polySym, t.multiplier, t.unit, t.days, key);
        if (closes.length < 20) continue;
        const price = closes[closes.length - 1];
        const smaSeries = sma(closes, 20);
        const smaVal = smaSeries[smaSeries.length - 1] ?? price;
        const rsiSeries = rsi(closes, 14);
        const rsiVal = rsiSeries[rsiSeries.length - 1] ?? 50;
        const first = closes[Math.max(0, closes.length - 20)];
        const changePct = first > 0 ? ((price - first) / first) * 100 : 0;
        out.push({ tf: t.tf, label: t.label, verdict: verdictFrom(price, smaVal, rsiVal), price, sma20: smaVal, rsi14: rsiVal, changePct });
      } catch { /* skip tf */ }
      // small delay to avoid Polygon free-tier throttling
      await new Promise((r) => setTimeout(r, 300));
    }

    if (out.length === 0) return { available: false, reason: "no_data" };

    const score = out.reduce((s, r) => s + (r.verdict === "bullish" ? 1 : r.verdict === "bearish" ? -1 : 0), 0);
    const consensus: Verdict = score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";
    return { available: true, asset: raw, timeframes: out, consensus, score };
  });
