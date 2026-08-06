// Extracted from agent-backtest.ts specifically to fix Finding 11
// (TRADING_ENGINE_REVIEW.md): the original inline loop scored a symbol
// using closes[day] and then entered the trade at that SAME closes[day]
// price — assuming impossible zero-latency execution at the exact price
// used to generate the signal. This is a pure, testable function so the
// fix (enter at the NEXT bar's open, not the signal bar's close) has real
// hand-verified tests, consistent with this project's standard for any
// change to trading-relevant calculations.

import { sma } from "@/lib/indicators";

export type SymBars = { symbol: string; times: number[]; opens: number[]; closes: number[] };

export type BacktestTrade = { day: number; symbol: string; entry: number; exit: number; pnl_pct: number };

export type DaySimulationResult = { trades: BacktestTrade[]; dayPnlPct: number } | null;

/**
 * Simulates one day's picks and their outcomes.
 *
 * Scoring: momentum vs. SMA50, computed using data through and including
 * `day`'s close — this part is legitimate (day `day`'s close is known
 * once that session ends).
 *
 * Execution (the fix): entry is `opens[day + 1]` — the NEXT trading
 * session's open, not the same close used to generate the signal. Exit is
 * `closes[day + 1 + holdDays]` — the close `holdDays` full sessions after
 * entry. This is the standard, achievable backtest convention: you see a
 * day's close after the fact, decide to act, and the earliest realistic
 * fill is the following session's open.
 *
 * Returns null if there isn't enough SMA history yet for any symbol, or
 * no symbol qualifies.
 */
export function simulateBacktestDay(
  universe: SymBars[],
  day: number,
  picksPerDay: number,
  holdDays: number,
): DaySimulationResult {
  const scored: Array<{ u: SymBars; mom: number }> = [];
  for (const u of universe) {
    const closesSlice = u.closes.slice(0, day + 1);
    const smaArr = sma(closesSlice, 50);
    const s50 = smaArr[smaArr.length - 1];
    if (!s50) continue;
    const price = u.closes[day];
    scored.push({ u, mom: (price - s50) / s50 });
  }
  scored.sort((a, b) => b.mom - a.mom);
  const chosen = scored.slice(0, picksPerDay);
  if (chosen.length === 0) return null;

  const trades: BacktestTrade[] = [];
  let dayPnlPct = 0;
  for (const c of chosen) {
    const entry = c.u.opens[day + 1];
    const exit = c.u.closes[day + 1 + holdDays];
    if (entry == null || exit == null || !Number.isFinite(entry) || entry <= 0) continue;
    const r = (exit - entry) / entry;
    dayPnlPct += r / chosen.length;
    trades.push({
      day,
      symbol: c.u.symbol,
      entry: Number(entry.toFixed(4)),
      exit: Number(exit.toFixed(4)),
      pnl_pct: Number((r * 100).toFixed(2)),
    });
  }

  if (trades.length === 0) return null;
  return { trades, dayPnlPct };
}

/**
 * The last valid `day` index for the simulation loop, given how far ahead
 * of `day` the function needs to read (day+1 for entry, day+1+holdDays
 * for exit). Extracted so the route handler and tests agree on the exact
 * same boundary condition rather than each computing it independently.
 */
export function lastValidSimulationDay(seriesLength: number, holdDays: number): number {
  return seriesLength - holdDays - 2; // last index i such that i+1+holdDays < seriesLength
}
