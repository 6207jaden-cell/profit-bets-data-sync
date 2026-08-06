// Extracted from agent-backtest.ts specifically to fix Finding 11
// (TRADING_ENGINE_REVIEW.md): the original inline loop scored a symbol
// using closes[day] and then entered the trade at that SAME closes[day]
// price — assuming impossible zero-latency execution at the exact price
// used to generate the signal. This is a pure, testable function so the
// fix (enter at the NEXT bar's open, not the signal bar's close) has real
// hand-verified tests, consistent with this project's standard for any
// change to trading-relevant calculations.

import { sma, isCryptoSymbol } from "@/lib/indicators";
import { estimateSlippageBps, applySlippage } from "@/lib/slippage";

export type SymBars = { symbol: string; times: number[]; opens: number[]; closes: number[] };

export type BacktestTrade = { day: number; symbol: string; entry: number; exit: number; pnl_pct: number };

export type DaySimulationResult = { trades: BacktestTrade[]; dayPnlPct: number } | null;

/**
 * Assumed order notional for slippage estimation (Finding 13's fix). This
 * backtest doesn't track real position sizing — it works in percentage
 * returns, not dollar amounts with real quantities — so this is a
 * reasonable, explicitly documented default representing a moderate
 * retail order size, not derived from any specific account. Average
 * daily volume is passed as unknown (null) for every symbol, since this
 * backtest doesn't fetch historical volume data — this lands in
 * estimateSlippageBps's conservative "unknown liquidity" tier rather than
 * assuming best-case liquidity, which is the more honest default.
 *
 * Fees are NOT modeled here: estimateFees() (cost-reality.ts) only
 * charges for options instruments, and this backtest's fixed 30-symbol
 * universe never includes any (stocks, ETFs, and crypto only) — calling
 * it would always return $0, so it's omitted rather than called
 * pointlessly.
 */
const ASSUMED_ORDER_NOTIONAL = 10_000;

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
    const rawEntry = c.u.opens[day + 1];
    const rawExit = c.u.closes[day + 1 + holdDays];
    if (rawEntry == null || rawExit == null || !Number.isFinite(rawEntry) || rawEntry <= 0) continue;

    const isCrypto = isCryptoSymbol(c.u.symbol);
    const entrySlip = estimateSlippageBps({ orderNotional: ASSUMED_ORDER_NOTIONAL, avgDailyVolume: null, price: rawEntry, isCrypto });
    const entry = applySlippage(rawEntry, "buy", entrySlip.slippageBps);
    const exitSlip = estimateSlippageBps({ orderNotional: ASSUMED_ORDER_NOTIONAL, avgDailyVolume: null, price: rawExit, isCrypto });
    const exit = applySlippage(rawExit, "sell", exitSlip.slippageBps);

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
