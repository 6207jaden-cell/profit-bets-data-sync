/**
 * News-driven catalyst scanner.
 * Aggregates Finnhub general + crypto news, extracts related tickers,
 * scores each by mention frequency × sentiment, returns a ranked list.
 * Used by:
 *  - Catalysts tab (UI)
 *  - Autonomous agent (dynamic universe injection)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type Catalyst = {
  symbol: string;
  mentions: number;
  sentiment: number; // -1..+1
  score: number;
  latestHeadline: string;
  latestUrl: string;
  latestAt: number;
  sources: string[];
};

const BULL = ["beat","surge","rally","soar","growth","record","upgrade","outperform","gain","jump","rise","boost","bullish","breakout","approval","partnership","acquire","buyback"];
const BEAR = ["miss","plunge","crash","decline","downgrade","warn","cut","fall","drop","slump","loss","fear","concern","bearish","lawsuit","probe","recall","layoff","bankruptcy"];

function sentimentScore(text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of BULL) if (t.includes(w)) s += 1;
  for (const w of BEAR) if (t.includes(w)) s -= 1;
  return Math.max(-3, Math.min(3, s)) / 3;
}

type FinnhubNews = {
  id: number; headline: string; summary: string; url: string;
  source: string; datetime: number; related?: string;
};

async function fetchNews(category: "general" | "crypto", key: string): Promise<FinnhubNews[]> {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${key}`);
    if (!r.ok) return [];
    return (await r.json()) as FinnhubNews[];
  } catch {
    return [];
  }
}

export async function scanCatalystsInternal(limit = 20): Promise<Catalyst[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const [general, crypto] = await Promise.all([fetchNews("general", key), fetchNews("crypto", key)]);
  const all = [...general, ...crypto];
  const map = new Map<string, Catalyst>();
  for (const n of all) {
    const relatedRaw = (n.related ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (relatedRaw.length === 0) continue;
    const senti = sentimentScore(`${n.headline} ${n.summary}`);
    for (const sym of relatedRaw.slice(0, 6)) {
      // Filter obvious non-tickers (long strings, punctuation)
      if (!/^[A-Z]{1,6}(-USD)?$/.test(sym)) continue;
      const existing = map.get(sym);
      if (existing) {
        existing.mentions += 1;
        existing.sentiment = (existing.sentiment * (existing.mentions - 1) + senti) / existing.mentions;
        if (n.datetime * 1000 > existing.latestAt) {
          existing.latestAt = n.datetime * 1000;
          existing.latestHeadline = n.headline;
          existing.latestUrl = n.url;
        }
        if (!existing.sources.includes(n.source)) existing.sources.push(n.source);
      } else {
        map.set(sym, {
          symbol: sym, mentions: 1, sentiment: senti,
          score: 0,
          latestHeadline: n.headline, latestUrl: n.url, latestAt: n.datetime * 1000,
          sources: [n.source],
        });
      }
    }
  }
  const out = Array.from(map.values()).map((c) => ({
    ...c,
    // Score: heavy weight on mention count, boosted by |sentiment|
    score: Number((c.mentions * (1 + Math.abs(c.sentiment) * 0.75)).toFixed(2)),
  }));
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export const scanNewsCatalysts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(50).optional() }).parse(d ?? {}))
  .handler(async ({ data }): Promise<{ ok: true; catalysts: Catalyst[] } | { ok: false; reason: string }> => {
    if (!process.env.FINNHUB_API_KEY) return { ok: false, reason: "missing_api_key" };
    const catalysts = await scanCatalystsInternal(data.limit ?? 20);
    return { ok: true, catalysts };
  });
