// Direction-aware candidate scoring + adaptive per-signal weight learning.
//
// PROBLEM THIS SOLVES: the original opportunityScore() added points for
// RSI > 70 AND RSI < 30 — both signal "something interesting is happening"
// but one is a long setup and the other is a short setup. A stock could
// score highly while the score itself carries no information about which
// direction to actually trade. This module splits scoring into bullScore
// and bearScore so a candidate's direction and conviction are both explicit,
// and a candidate where both scores are high (conflicting signals — a
// choppy stock) can be identified and down-weighted rather than traded.
//
// It also closes the loop with the learning system: every signal that
// contributes to a score is tagged by name, recorded on the trade at entry
// (paper_trades.entry_signals), and its real win rate is tracked per user
// via a Bayesian Beta-distribution estimate that updates the moment a trade
// closes. Scoring then multiplies each signal's contribution by that user's
// learned weight for it — a signal with a 30% historical win rate for this
// user contributes less to future scores than one with a 70% win rate,
// automatically, without needing a scheduled retraining job.

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type CandidateInput = {
  rsi: number | null;
  momentum_pct: number;
  vol_surge_pct: number;
  five_day_return: number;
  twenty_day_return: number;
  rs_vs_spy_5d: number;
  regime_aligned: boolean;
  macd_histogram: number | null;
  bb_pct_b: number | null;
  avg_volume_20d: number;
  stoch_rsi_k: number | null;
};

export type SignalScoreResult = {
  bullScore: number;
  bearScore: number;
  bullSignals: string[];
  bearSignals: string[];
  /** bullScore - bearScore, positive = long lean, negative = short lean */
  netScore: number;
  /** min(bullScore, bearScore) — high value means conflicting signals (choppy) */
  conflictScore: number;
  /** 0-1, how dominant the leading direction is over the other. Low = avoid. */
  confidence: number;
};

/**
 * Computes direction-split bull/bear scores for a candidate using RAW (not
 * yet weight-adjusted) signal contributions. Call applySignalWeights() after
 * this with a user's learned weight map to get the final, personalized score.
 */
export function computeDirectionalScores(c: CandidateInput, regime: "bull" | "bear" | "sideways"): SignalScoreResult {
  const bull: Record<string, number> = {};
  const bear: Record<string, number> = {};

  // Momentum vs SMA50 — magnitude matters, sign determines direction
  if (c.momentum_pct >= 0) bull.momentum = c.momentum_pct * 0.3;
  else bear.momentum = Math.abs(c.momentum_pct) * 0.3;

  // 5-day return
  if (c.five_day_return >= 0) bull.return_5d = c.five_day_return * 0.25;
  else bear.return_5d = Math.abs(c.five_day_return) * 0.25;

  // 20-day trend
  if (c.twenty_day_return >= 0) bull.return_20d = c.twenty_day_return * 0.1;
  else bear.return_20d = Math.abs(c.twenty_day_return) * 0.1;

  // Relative strength vs SPY
  if (c.rs_vs_spy_5d >= 0) {
    bull.rs_vs_spy = c.rs_vs_spy_5d * 0.2;
    if (c.rs_vs_spy_5d > 2) bull.rs_strong_outperform = 8;
  } else {
    bear.rs_vs_spy = Math.abs(c.rs_vs_spy_5d) * 0.2;
    if (c.rs_vs_spy_5d < -2) bear.rs_strong_underperform = 6;
  }

  // Regime alignment bonus — applies to whichever side matches the current regime
  if (regime === "bull" && c.momentum_pct > 0) bull.regime_aligned = 5;
  if (regime === "bear" && c.momentum_pct < 0) bear.regime_aligned = 5;

  // RSI extremes — oversold is a bullish (bounce) signal, overbought is bearish
  if (c.rsi != null && c.rsi < 30) bull.rsi_oversold = 8;
  if (c.rsi != null && c.rsi > 70) bear.rsi_overbought = 6;

  // Volume surge amplifies whichever direction is already leading (confirms the move)
  const volBoost = Math.min(c.vol_surge_pct, 200) * 0.02;
  const leadingSoFar = Object.values(bull).reduce((s, v) => s + v, 0) >= Object.values(bear).reduce((s, v) => s + v, 0);
  if (leadingSoFar) bull.volume_surge = volBoost; else bear.volume_surge = volBoost;
  if (c.vol_surge_pct > 50) { if (leadingSoFar) bull.volume_surge_strong = 10; else bear.volume_surge_strong = 10; }

  // Liquidity — not directional, applies as a floor/penalty to both sides equally
  const liquidityAdj = c.avg_volume_20d > 10_000_000 ? 3 : c.avg_volume_20d < 100_000 ? -5 : 0;
  if (liquidityAdj !== 0) { bull.liquidity = liquidityAdj; bear.liquidity = liquidityAdj; }

  // MACD histogram
  if (c.macd_histogram != null && c.macd_histogram > 0) bull.macd_bullish = 5;
  if (c.macd_histogram != null && c.macd_histogram < 0) bear.macd_bearish = 4;

  // Bollinger Band extremes (mean reversion)
  if (c.bb_pct_b != null && c.bb_pct_b < 0.05) bull.bb_lower_band = 9;
  if (c.bb_pct_b != null && c.bb_pct_b > 0.95) bear.bb_upper_band = 7;

  // Stochastic RSI (more sensitive turning-point signal)
  if (c.stoch_rsi_k != null && c.stoch_rsi_k < 20) bull.stoch_oversold = 8;
  if (c.stoch_rsi_k != null && c.stoch_rsi_k > 80) bear.stoch_overbought = 6;

  const bullScore = Object.values(bull).reduce((s, v) => s + v, 0);
  const bearScore = Object.values(bear).reduce((s, v) => s + v, 0);
  const netScore = bullScore - bearScore;
  const conflictScore = Math.min(bullScore, bearScore);
  const total = bullScore + bearScore;
  const confidence = total > 0 ? Math.abs(bullScore - bearScore) / total : 0;

  return {
    bullScore, bearScore, netScore, conflictScore, confidence,
    bullSignals: Object.keys(bull), bearSignals: Object.keys(bear),
  };
}

export type SignalWeightMap = Map<string, number>; // signal_name -> weight_multiplier

/** Loads a user's learned signal weights. Missing signals default to neutral 1.0x. */
export async function loadSignalWeights(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
): Promise<SignalWeightMap> {
  const map: SignalWeightMap = new Map();
  try {
    const { data } = await supabaseAdmin
      .from("agent_signal_weights")
      .select("signal_name, weight_multiplier")
      .eq("user_id", userId);
    for (const row of data ?? []) {
      map.set(row.signal_name as string, Number(row.weight_multiplier));
    }
  } catch {
    // fall through — empty map means everything defaults to neutral 1.0x
  }
  return map;
}

/**
 * Re-scores a raw SignalScoreResult using the user's learned weights. Each
 * named signal's contribution is looked up individually and multiplied by
 * its learned weight — this requires re-deriving per-signal contributions,
 * so this function takes the candidate + regime again rather than trying to
 * reverse-engineer contributions from the aggregate scores.
 */
export function applySignalWeights(
  c: CandidateInput,
  regime: "bull" | "bear" | "sideways",
  weights: SignalWeightMap,
): SignalScoreResult {
  const w = (name: string) => weights.get(name) ?? 1.0;
  const bull: Record<string, number> = {};
  const bear: Record<string, number> = {};

  if (c.momentum_pct >= 0) bull.momentum = c.momentum_pct * 0.3 * w("momentum");
  else bear.momentum = Math.abs(c.momentum_pct) * 0.3 * w("momentum");

  if (c.five_day_return >= 0) bull.return_5d = c.five_day_return * 0.25 * w("return_5d");
  else bear.return_5d = Math.abs(c.five_day_return) * 0.25 * w("return_5d");

  if (c.twenty_day_return >= 0) bull.return_20d = c.twenty_day_return * 0.1 * w("return_20d");
  else bear.return_20d = Math.abs(c.twenty_day_return) * 0.1 * w("return_20d");

  if (c.rs_vs_spy_5d >= 0) {
    bull.rs_vs_spy = c.rs_vs_spy_5d * 0.2 * w("rs_vs_spy");
    if (c.rs_vs_spy_5d > 2) bull.rs_strong_outperform = 8 * w("rs_strong_outperform");
  } else {
    bear.rs_vs_spy = Math.abs(c.rs_vs_spy_5d) * 0.2 * w("rs_vs_spy");
    if (c.rs_vs_spy_5d < -2) bear.rs_strong_underperform = 6 * w("rs_strong_underperform");
  }

  if (regime === "bull" && c.momentum_pct > 0) bull.regime_aligned = 5 * w("regime_aligned");
  if (regime === "bear" && c.momentum_pct < 0) bear.regime_aligned = 5 * w("regime_aligned");

  if (c.rsi != null && c.rsi < 30) bull.rsi_oversold = 8 * w("rsi_oversold");
  if (c.rsi != null && c.rsi > 70) bear.rsi_overbought = 6 * w("rsi_overbought");

  const volBoost = Math.min(c.vol_surge_pct, 200) * 0.02;
  const leadingSoFar = Object.values(bull).reduce((s, v) => s + v, 0) >= Object.values(bear).reduce((s, v) => s + v, 0);
  if (leadingSoFar) bull.volume_surge = volBoost * w("volume_surge");
  else bear.volume_surge = volBoost * w("volume_surge");
  if (c.vol_surge_pct > 50) {
    if (leadingSoFar) bull.volume_surge_strong = 10 * w("volume_surge_strong");
    else bear.volume_surge_strong = 10 * w("volume_surge_strong");
  }

  const liquidityAdj = c.avg_volume_20d > 10_000_000 ? 3 : c.avg_volume_20d < 100_000 ? -5 : 0;
  if (liquidityAdj !== 0) { bull.liquidity = liquidityAdj; bear.liquidity = liquidityAdj; }

  if (c.macd_histogram != null && c.macd_histogram > 0) bull.macd_bullish = 5 * w("macd_bullish");
  if (c.macd_histogram != null && c.macd_histogram < 0) bear.macd_bearish = 4 * w("macd_bearish");

  if (c.bb_pct_b != null && c.bb_pct_b < 0.05) bull.bb_lower_band = 9 * w("bb_lower_band");
  if (c.bb_pct_b != null && c.bb_pct_b > 0.95) bear.bb_upper_band = 7 * w("bb_upper_band");

  if (c.stoch_rsi_k != null && c.stoch_rsi_k < 20) bull.stoch_oversold = 8 * w("stoch_oversold");
  if (c.stoch_rsi_k != null && c.stoch_rsi_k > 80) bear.stoch_overbought = 6 * w("stoch_overbought");

  const bullScore = Object.values(bull).reduce((s, v) => s + v, 0);
  const bearScore = Object.values(bear).reduce((s, v) => s + v, 0);
  const netScore = bullScore - bearScore;
  const conflictScore = Math.min(bullScore, bearScore);
  const total = bullScore + bearScore;
  const confidence = total > 0 ? Math.abs(bullScore - bearScore) / total : 0;

  return {
    bullScore, bearScore, netScore, conflictScore, confidence,
    bullSignals: Object.keys(bull), bearSignals: Object.keys(bear),
  };
}

/**
 * Bayesian Beta-distribution weight update, called the moment a trade closes.
 * No scheduled batch job needed — each closed trade immediately nudges the
 * weight of every signal that was active at its entry. New signals start at
 * alpha=1, beta=1 (50% estimated win rate, neutral 1.0x weight) so a single
 * early trade can't wildly swing a signal's weight; the estimate only
 * stabilizes as real sample size accumulates, which is the whole point of
 * using a Bayesian prior instead of a naive running win-rate.
 */
export async function updateSignalWeights(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
  entrySignals: string[] | null | undefined,
  pnlPct: number,
): Promise<void> {
  if (!entrySignals || entrySignals.length === 0) return; // manual trades have no recorded signals — skip

  const won = pnlPct > 0;

  for (const signalName of entrySignals) {
    try {
      const { data: existing } = await supabaseAdmin
        .from("agent_signal_weights")
        .select("*")
        .eq("user_id", userId)
        .eq("signal_name", signalName)
        .maybeSingle();

      const alpha = Number(existing?.alpha ?? 1) + (won ? 1 : 0);
      const beta = Number(existing?.beta ?? 1) + (won ? 0 : 1);
      const sampleSize = Number(existing?.sample_size ?? 0) + 1;
      const priorAvgPnl = Number(existing?.avg_pnl_pct ?? 0);
      const avgPnlPct = priorAvgPnl + (pnlPct - priorAvgPnl) / sampleSize;

      const winRate = alpha / (alpha + beta);
      // 50% win rate -> 1.0x neutral. 70% -> 1.2x boost. 30% -> 0.8x reduction.
      // Clamped so early small-sample noise can't send a weight to an extreme.
      const weightMultiplier = Math.max(0.4, Math.min(1.8, 0.5 + winRate));

      await supabaseAdmin.from("agent_signal_weights").upsert({
        user_id: userId,
        signal_name: signalName,
        alpha, beta, sample_size: sampleSize,
        avg_pnl_pct: Number(avgPnlPct.toFixed(3)),
        weight_multiplier: Number(weightMultiplier.toFixed(3)),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,signal_name" });
    } catch (e) {
      console.warn("[signal-learning] failed to update weight for", signalName, String(e));
    }
  }
}
