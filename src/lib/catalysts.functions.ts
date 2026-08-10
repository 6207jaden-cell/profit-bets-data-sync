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
import { matchesFinancialKeyword } from "@/lib/market.functions";

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

// Fixes the same substring-matching bug found and fixed in
// market.functions.ts's classify() during item 13's OWASP-adjacent
// review pass — this is a SEPARATE, independently-maintained
// implementation of near-identical sentiment classification logic that
// had the exact same bug ("gain" matching inside "bargain", "cut"
// matching inside "cutting-edge", "record" scored unconditionally
// bullish despite "record low"/"record losses" being common bearish
// constructions). More consequential than the UI-only classifier this
// duplicated: BULL/BEAR here directly influence `catalystSymbols` in
// autonomous-agent.ts, which affects which symbols the live trading
// agent actually scans. Reuses matchesFinancialKeyword
// (market.functions.ts) rather than a third re-implementation of the
// same word-boundary regex — same DRY instinct applied elsewhere in
// this project after finding real bugs caused by near-duplicate logic
// drifting apart (auth checks, instrument lists).
const BULL = [
  "beat", "beats", "surge", "surges", "surged", "surging",
  "rally", "rallies", "rallied", "rallying", "soar", "soars", "soared", "soaring",
  "growth", "upgrade", "upgraded", "outperform", "outperforms",
  "gain", "gains", "gained", "gaining", "jump", "jumps", "jumped", "jumping",
  "rise", "rises", "rising", "risen", "boost", "boosts", "boosted", "boosting",
  "bullish", "breakout", "breakouts", "approval", "approvals",
  "partnership", "partnerships", "acquire", "acquires", "acquired", "acquiring",
  "buyback", "buybacks",
];
const BEAR = [
  "miss", "misses", "missed", "plunge", "plunges", "plunged", "plunging",
  "crash", "crashes", "crashed", "crashing", "decline", "declines", "declined", "declining",
  "downgrade", "downgraded", "warn", "warns", "warned", "warning",
  "cut", "cuts", "slashed", "fall", "falls", "fell", "falling", "fallen",
  "drop", "drops", "dropped", "dropping", "slump", "slumps", "slumped",
  "loss", "losses", "fear", "fears", "concern", "concerns", "concerned",
  "bearish", "lawsuit", "lawsuits", "probe", "probes", "probed", "probing",
  "recall", "recalls", "recalled", "recalling", "layoff", "layoffs", "bankruptcy", "bankruptcies",
];

export function sentimentScore(text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of BULL) if (matchesFinancialKeyword(t, w)) s += 1;
  for (const w of BEAR) if (matchesFinancialKeyword(t, w)) s -= 1;
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
