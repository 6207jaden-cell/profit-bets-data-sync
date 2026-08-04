// Earnings options strategy — the sharpest edge in the whole scoring system.
// Instead of just avoiding stocks with earnings coming up (the old behavior),
// this actively compares what the options market is PRICING IN for the move
// (derived from the ATM straddle) against what the stock has ACTUALLY
// averaged on its last several earnings reports. That mismatch is a more
// reliable signal than any single technical indicator:
//   - Market prices a 5% move, stock has averaged 9% historically -> options
//     underpriced, buy them.
//   - Market prices 8%, stock has only ever averaged 3% -> options
//     overpriced, sell premium instead.
//
// IMPORTANT EXECUTION NOTE: this module recommends instruments that the
// existing trade-execution code actually resolves correctly today — single
// long calls/puts and call/put credit spreads. "iron_condor" appears in the
// AI's JSON schema as a choosable instrument type but the execution code's
// isOptionsInstrument check doesn't include it, so it would silently fall
// through to broken stock-style position math rather than a real 4-leg
// spread. Rather than recommend a path that doesn't actually work end to
// end, "sell premium" recommendations here map to a credit spread
// (call_spread or put_spread, which ARE properly resolved) instead of a
// true iron condor. True strangles (long call + long put as one position)
// aren't a native instrument either, so "buy" recommendations map to a
// single directional call or put in the direction the setup favors.

import type { Bars } from "./indicators";

export type HistoricalEarningsDate = { date: string; actual: number | null; estimate: number | null };

/** Last N earnings report dates + actual/estimate from Finnhub (keyed on FINNHUB_API_KEY). */
export async function fetchHistoricalEarningsDates(symbol: string, limit = 8): Promise<HistoricalEarningsDate[] | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/earnings?symbol=${symbol.toUpperCase()}&limit=${limit}&token=${key}`);
    if (!r.ok) return null;
    const j = (await r.json()) as Array<{ date?: string; actual?: number; estimate?: number }>;
    return j.filter((e) => e.date).map((e) => ({ date: e.date!, actual: e.actual ?? null, estimate: e.estimate ?? null }));
  } catch {
    return null;
  }
}

/**
 * Average absolute % price move around each historical earnings date, found
 * by matching each date to the nearest bar and comparing the close just
 * before vs. the close 1-2 sessions after (wide enough to catch the reaction
 * regardless of before-market/after-market report timing). Needs the caller
 * to supply bars covering back to the oldest earnings date being checked —
 * typically ~2 years for 6-8 quarterly reports.
 */
export function computeAvgHistoricalEarningsMove(dates: HistoricalEarningsDate[], bars: Bars): number | null {
  const moves: number[] = [];
  for (const e of dates) {
    const earningsTime = new Date(e.date).getTime();
    if (!Number.isFinite(earningsTime)) continue;
    let beforeIdx = -1, afterIdx = -1;
    for (let i = 0; i < bars.times.length; i++) {
      if (bars.times[i] <= earningsTime) beforeIdx = i;
      if (bars.times[i] >= earningsTime && afterIdx === -1) afterIdx = i;
    }
    const afterIdx2 = Math.min(bars.times.length - 1, (afterIdx >= 0 ? afterIdx : beforeIdx) + 1);
    if (beforeIdx >= 0 && afterIdx2 > beforeIdx && bars.closes[beforeIdx] > 0) {
      const move = Math.abs((bars.closes[afterIdx2] - bars.closes[beforeIdx]) / bars.closes[beforeIdx]) * 100;
      if (Number.isFinite(move) && move < 50) moves.push(move); // sanity cap against bad data
    }
  }
  if (moves.length < 2) return null; // need at least 2 data points for a meaningful average
  return moves.reduce((s, v) => s + v, 0) / moves.length;
}

/** Expected move implied by an ATM straddle price, as a % of stock price. */
export function computeExpectedMoveFromStraddle(callMid: number, putMid: number, stockPrice: number): number | null {
  if (stockPrice <= 0) return null;
  return ((callMid + putMid) / stockPrice) * 100;
}

/** Annualized historical/realized volatility (%) from a closes series — standard stdev-of-log-returns method. */
export function computeHistoricalVolatility(closes: number[], lookbackDays = 20): number | null {
  if (closes.length < lookbackDays + 1) return null;
  const recent = closes.slice(-lookbackDays - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] > 0 && recent[i] > 0) logReturns.push(Math.log(recent[i] / recent[i - 1]));
  }
  if (logReturns.length < 5) return null;
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/**
 * IV relative to realized volatility — works immediately with data already
 * available (no history-accumulation period needed), unlike IV Rank below.
 * "High IV" only means something relative to a baseline; comparing to this
 * stock's own recent realized volatility is that baseline.
 */
export function computeIvHvRatio(currentIvPct: number, historicalVolPct: number): { ratio: number; interpretation: string } | null {
  if (historicalVolPct <= 0) return null;
  const ratio = currentIvPct / historicalVolPct;
  const interpretation =
    ratio > 1.5 ? "options rich vs realized vol — favor selling premium"
    : ratio > 1.2 ? "options moderately rich"
    : ratio < 0.8 ? "options cheap vs realized vol — favor buying"
    : "options fairly priced relative to realized volatility";
  return { ratio: Number(ratio.toFixed(2)), interpretation };
}

/**
 * True IV Rank — current IV's percentile within this specific stock's own
 * trailing ~1-year IV range, the gold-standard version of "is IV high."
 * Requires accumulated history: starts returning null (insufficient data)
 * and only becomes meaningful after enough daily snapshots build up, same
 * honest ramp-up pattern as the Stage 2 signal-weight learning. IV/HV above
 * is the fallback that works from day one while this accumulates.
 */
export async function getIvRank(
  supabaseAdmin: { from: (table: string) => any },
  symbol: string,
  currentIvPct: number,
): Promise<{ rank: number | null; sampleSize: number }> {
  try {
    await supabaseAdmin.from("iv_history_snapshots").insert({ symbol: symbol.toUpperCase(), iv_pct: currentIvPct });
  } catch { /* best-effort */ }

  try {
    const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString();
    const { data } = await supabaseAdmin
      .from("iv_history_snapshots")
      .select("iv_pct")
      .eq("symbol", symbol.toUpperCase())
      .gte("created_at", oneYearAgo);
    const ivs = ((data ?? []) as Array<{ iv_pct: number }>).map((r) => Number(r.iv_pct)).filter((v) => Number.isFinite(v));
    if (ivs.length < 15) return { rank: null, sampleSize: ivs.length };
    const sorted = [...ivs].sort((a, b) => a - b);
    const belowCount = sorted.filter((v) => v <= currentIvPct).length;
    return { rank: Math.round((belowCount / sorted.length) * 100), sampleSize: ivs.length };
  } catch {
    return { rank: null, sampleSize: 0 };
  }
}

export type EarningsStrategyResult = {
  strategy: "buy_call" | "buy_put" | "sell_call_spread" | "sell_put_spread" | "post_earnings_continuation" | "neutral";
  rationale: string;
};

/**
 * Combines expected-move-vs-historical-move (sharpest signal when both are
 * available), IV Rank (once enough history exists), IV/HV ratio (works
 * immediately), and post-earnings momentum into one recommendation — mapped
 * only to instruments the execution code actually resolves correctly.
 */
export function classifyEarningsStrategy(input: {
  daysToEarnings: number;
  expectedMovePct: number | null;
  avgHistoricalMovePct: number | null;
  ivHvRatio: number | null;
  ivRank: number | null;
  recentMomentumPct: number; // e.g. 5-day return, used to pick call vs put direction
}): EarningsStrategyResult {
  const { daysToEarnings, expectedMovePct, avgHistoricalMovePct, ivHvRatio, ivRank, recentMomentumPct } = input;
  const bullishLean = recentMomentumPct >= 0;

  // Sharpest signal: what the market is pricing in vs. what actually happens
  if (expectedMovePct != null && avgHistoricalMovePct != null) {
    const gap = avgHistoricalMovePct - expectedMovePct;
    if (gap > 2) {
      return {
        strategy: bullishLean ? "buy_call" : "buy_put",
        rationale: `Options pricing a ${expectedMovePct.toFixed(1)}% move but this stock has historically averaged ${avgHistoricalMovePct.toFixed(1)}% on earnings — options underpriced relative to the real risk, buy directional exposure.`,
      };
    }
    if (gap < -2) {
      return {
        strategy: bullishLean ? "sell_put_spread" : "sell_call_spread",
        rationale: `Options pricing a ${expectedMovePct.toFixed(1)}% move but this stock has only averaged ${avgHistoricalMovePct.toFixed(1)}% historically — options overpriced, sell a credit spread instead of buying.`,
      };
    }
  }

  // Fallback: IV Rank once enough history exists, else IV/HV (works from day one)
  if (ivRank != null) {
    if (ivRank > 60) return { strategy: bullishLean ? "sell_put_spread" : "sell_call_spread", rationale: `IV Rank ${ivRank} — implied vol elevated vs this stock's own 1-year range, favor selling premium.` };
    if (ivRank < 30) return { strategy: bullishLean ? "buy_call" : "buy_put", rationale: `IV Rank ${ivRank} — implied vol low vs this stock's own range, favor buying.` };
  } else if (ivHvRatio != null) {
    if (ivHvRatio > 1.4) return { strategy: bullishLean ? "sell_put_spread" : "sell_call_spread", rationale: `IV/HV ratio ${ivHvRatio.toFixed(2)} — options rich vs realized volatility, favor selling premium.` };
    if (ivHvRatio < 0.85) return { strategy: bullishLean ? "buy_call" : "buy_put", rationale: `IV/HV ratio ${ivHvRatio.toFixed(2)} — options cheap vs realized volatility, favor buying.` };
  }

  // Post-earnings continuation: earnings already happened and the stock gapped meaningfully
  if (daysToEarnings <= 0 && Math.abs(recentMomentumPct) > 4) {
    return {
      strategy: "post_earnings_continuation",
      rationale: `Stock gapped ${recentMomentumPct > 0 ? "up" : "down"} ${Math.abs(recentMomentumPct).toFixed(1)}% on earnings — historically these moves continue further over the next few sessions. Trade the underlying stock in the continuation direction, not options.`,
    };
  }

  return { strategy: "neutral", rationale: "No strong edge from expected-move comparison, IV rank, or post-earnings momentum — treat as any other candidate." };
}
