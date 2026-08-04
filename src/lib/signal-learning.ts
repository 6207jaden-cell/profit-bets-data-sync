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
/**
 * The canonical list of every signal name the scoring system can produce
 * (see computeDirectionalScores/applySignalWeights below). Needed for
 * Experiment 4's present-vs-absent contribution analysis — to know a
 * signal was "absent" on a trade requires knowing the full universe of
 * possible signals, not just the ones that happened to fire.
 *
 * Caveat worth being explicit about: several of these are mutually
 * exclusive pairs by construction (rsi_oversold/rsi_overbought,
 * macd_bullish/macd_bearish, bb_lower_band/bb_upper_band,
 * stoch_oversold/stoch_overbought, rs_strong_outperform/
 * rs_strong_underperform — RSI cannot be both <30 and >70 on the same
 * candidate). For these pairs, "absent" conflates two different states:
 * the neutral zone (e.g., RSI 30-70) AND the opposite extreme (e.g., RSI
 * >70 when checking "absent rsi_oversold"). This phase tracks simple
 * present/absent as specified; a future refinement could separate
 * present / absent-neutral / absent-opposite for these specific pairs.
 * Documented here and in EXPERIMENT_RESULTS.md rather than silently
 * treated as a clean comparison.
 */
export const ALL_TRACKED_SIGNALS = [
  "momentum", "return_5d", "return_20d", "rs_vs_spy", "rs_strong_outperform",
  "rs_strong_underperform", "regime_aligned", "rsi_oversold", "rsi_overbought",
  "volume_surge", "volume_surge_strong", "liquidity", "macd_bullish", "macd_bearish",
  "bb_lower_band", "bb_upper_band", "stoch_oversold", "stoch_overbought",
] as const;

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

export type SignalStats = {
  weightMultiplier: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  sampleSize: number;
};
export type SignalStatsMap = Map<string, SignalStats>;

/**
 * Loads a user's full learned signal statistics (win rate, avg win/loss
 * magnitude, sample size) in one query. Stage 2's direction-split scoring
 * only needs weightMultiplier (see loadSignalWeights below, a thin wrapper
 * over this); Kelly Criterion sizing needs the richer win/loss data. Sharing
 * one query avoids fetching the same table twice per scan.
 */
export async function loadFullSignalStats(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
): Promise<SignalStatsMap> {
  const map: SignalStatsMap = new Map();
  try {
    const { data } = await supabaseAdmin
      .from("agent_signal_weights")
      .select("signal_name, weight_multiplier, alpha, beta, avg_win_pct, avg_loss_pct, sample_size")
      .eq("user_id", userId);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const alpha = Number(row.alpha ?? 1);
      const beta = Number(row.beta ?? 1);
      map.set(String(row.signal_name), {
        weightMultiplier: Number(row.weight_multiplier ?? 1),
        winRate: alpha / (alpha + beta),
        avgWinPct: Number(row.avg_win_pct ?? 0),
        avgLossPct: Number(row.avg_loss_pct ?? 0),
        sampleSize: Number(row.sample_size ?? 0),
      });
    }
  } catch {
    // fall through — empty map means everything defaults to neutral/unavailable
  }
  return map;
}

/** Loads a user's learned signal weights. Missing signals default to neutral 1.0x. */
export async function loadSignalWeights(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
): Promise<SignalWeightMap> {
  const full = await loadFullSignalStats(supabaseAdmin, userId);
  const map: SignalWeightMap = new Map();
  for (const [name, stats] of full) map.set(name, stats.weightMultiplier);
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

      // Win/loss magnitudes tracked SEPARATELY (not just the blended average
      // above) — Kelly Criterion sizing needs these as independent inputs.
      // Same incremental-average update pattern, but only the winning trades
      // update avg_win_pct and only losing trades update avg_loss_pct.
      let winCount = Number(existing?.win_count ?? 0);
      let lossCount = Number(existing?.loss_count ?? 0);
      let avgWinPct = Number(existing?.avg_win_pct ?? 0);
      let avgLossPct = Number(existing?.avg_loss_pct ?? 0);
      if (won) {
        winCount += 1;
        avgWinPct = avgWinPct + (pnlPct - avgWinPct) / winCount;
      } else {
        lossCount += 1;
        avgLossPct = avgLossPct + (Math.abs(pnlPct) - avgLossPct) / lossCount;
      }

      const winRate = alpha / (alpha + beta);
      // 50% win rate -> 1.0x neutral. 70% -> 1.2x boost. 30% -> 0.8x reduction.
      // Clamped so early small-sample noise can't send a weight to an extreme.
      const weightMultiplier = Math.max(0.4, Math.min(1.8, 0.5 + winRate));

      await supabaseAdmin.from("agent_signal_weights").upsert({
        user_id: userId,
        signal_name: signalName,
        alpha, beta, sample_size: sampleSize,
        avg_pnl_pct: Number(avgPnlPct.toFixed(3)),
        avg_win_pct: Number(avgWinPct.toFixed(3)),
        avg_loss_pct: Number(avgLossPct.toFixed(3)),
        win_count: winCount,
        loss_count: lossCount,
        weight_multiplier: Number(weightMultiplier.toFixed(3)),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,signal_name" });
    } catch (e) {
      console.warn("[signal-learning] failed to update weight for", signalName, String(e));
    }
  }

  // ── Experiment 4 (Signal Contribution Analysis): absent-side tracking ──
  // For every KNOWN signal that was NOT active on this trade, update its
  // "absent" Bayesian track — pure observation, does NOT touch
  // weight_multiplier or any present-side field above. This is what makes
  // a genuine present-vs-absent comparison possible later, rather than
  // only ever seeing "how did trades WITH this signal do" in isolation.
  // See HYPOTHESIS_LOG.md, EXPERIMENTS.md E-08.
  const presentSet = new Set(entrySignals);
  for (const signalName of ALL_TRACKED_SIGNALS) {
    if (presentSet.has(signalName)) continue; // this trade HAD the signal — present-side loop above already handled it
    try {
      const { data: existing } = await supabaseAdmin
        .from("agent_signal_weights")
        .select("absent_alpha, absent_beta, absent_sample_size, absent_avg_pnl_pct")
        .eq("user_id", userId)
        .eq("signal_name", signalName)
        .maybeSingle();

      const absentAlpha = Number(existing?.absent_alpha ?? 1) + (won ? 1 : 0);
      const absentBeta = Number(existing?.absent_beta ?? 1) + (won ? 0 : 1);
      const absentSampleSize = Number(existing?.absent_sample_size ?? 0) + 1;
      const priorAbsentAvg = Number(existing?.absent_avg_pnl_pct ?? 0);
      const absentAvgPnl = priorAbsentAvg + (pnlPct - priorAbsentAvg) / absentSampleSize;

      await supabaseAdmin.from("agent_signal_weights").upsert({
        user_id: userId,
        signal_name: signalName,
        absent_alpha: absentAlpha,
        absent_beta: absentBeta,
        absent_sample_size: absentSampleSize,
        absent_avg_pnl_pct: Number(absentAvgPnl.toFixed(3)),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,signal_name" });
    } catch (e) {
      console.warn("[signal-learning] failed to update absent stats for", signalName, String(e));
    }
  }
}

export type KellySizeResult = {
  multiplier: number;
  kellyFractionPct: number | null;
  reason: string;
};

/**
 * Fractional-Kelly position-size multiplier derived from this account's own
 * real trade history — the biggest untapped lever once enough data exists.
 * Rather than replace the AI's allocation_pct outright (a much bigger,
 * riskier change to an already-live sizing system), this produces a
 * multiplier in the same 0.4x-1.8x family as the other adjustments already
 * folded into the allocPct chain (VIX/regime, correlation, weekend,
 * breadth) — consistent, predictable, and easy to reason about alongside
 * them rather than a competing sizing paradigm.
 *
 * Deliberately uses the SINGLE most information-rich active signal (highest
 * sample_size) rather than trying to blend multiple signals' stats together
 * — combining win rates and win/loss magnitudes across signals with
 * different sample sizes in a statistically sound way is a real modeling
 * problem on its own; using the most-observed single signal is simpler,
 * more conservative, and easier to explain than a shaky blended estimate.
 */
export function computeKellySizeMultiplier(
  entrySignals: string[] | null | undefined,
  statsMap: SignalStatsMap,
  minSampleSize = 15,
): KellySizeResult {
  if (!entrySignals || entrySignals.length === 0) {
    return { multiplier: 1.0, kellyFractionPct: null, reason: "no tracked signals for this trade — using AI's own sizing" };
  }

  // Pick the active signal with the most accumulated history.
  let best: SignalStats | null = null;
  let bestName = "";
  for (const name of entrySignals) {
    const stats = statsMap.get(name);
    if (stats && (!best || stats.sampleSize > best.sampleSize)) {
      best = stats;
      bestName = name;
    }
  }

  if (!best || best.sampleSize < minSampleSize || best.avgLossPct <= 0 || best.avgWinPct <= 0) {
    const sample = best?.sampleSize ?? 0;
    return { multiplier: 1.0, kellyFractionPct: null, reason: `insufficient sample size (${sample}/${minSampleSize}) — using AI's own sizing` };
  }

  const p = best.winRate;
  const q = 1 - p;
  const b = best.avgWinPct / best.avgLossPct; // win/loss ratio
  const fullKelly = (b * p - q) / b;
  const fractionalKelly = fullKelly * 0.4; // 40% of full Kelly — standard practice to reduce variance vs full Kelly's aggressive swings
  const kellyFractionPct = Math.max(0, Math.min(fractionalKelly, 0.25)) * 100; // hard cap at 25% regardless of what the formula suggests

  // Normalize against a baseline "typical good trade" Kelly fraction (~8%)
  // to produce a multiplier consistent with the other 0.4x-1.8x adjustments
  // already in the allocation chain, rather than a wildly different scale.
  const baseline = 8;
  const multiplier = Math.max(0.4, Math.min(kellyFractionPct / baseline, 1.8));

  const reason = kellyFractionPct <= 0
    ? `signal "${bestName}" shows negative edge over ${best.sampleSize} trades — sizing down`
    : `signal "${bestName}": ${best.sampleSize} trades, ${(p * 100).toFixed(0)}% win rate, ${best.avgWinPct.toFixed(1)}% avg win vs ${best.avgLossPct.toFixed(1)}% avg loss`;

  return { multiplier: Number(multiplier.toFixed(3)), kellyFractionPct: Number(kellyFractionPct.toFixed(1)), reason };
}

// ── Experiment 4 (Signal Contribution Analysis) reporting ───────────────

export type SignalContributionRow = {
  signalName: string;
  presentSampleSize: number;
  presentWinRate: number;
  presentAvgPnlPct: number;
  absentSampleSize: number;
  absentWinRate: number;
  absentAvgPnlPct: number;
  /** presentAvgPnlPct - absentAvgPnlPct — the actual "contribution" figure: how much better (or worse) trades WITH this signal did vs trades WITHOUT it. */
  contributionPct: number;
  /** True only once BOTH sides have a minimally meaningful sample — an honest "don't over-read this yet" gate, not a statistical significance test. */
  hasMinimumEvidence: boolean;
  isMutuallyExclusivePair: boolean;
};

const MUTUALLY_EXCLUSIVE_SIGNALS = new Set([
  "rsi_oversold", "rsi_overbought", "macd_bullish", "macd_bearish",
  "bb_lower_band", "bb_upper_band", "stoch_oversold", "stoch_overbought",
  "rs_strong_outperform", "rs_strong_underperform",
]);

const MIN_SAMPLE_FOR_COMPARISON = 10;

/**
 * Reads the full present/absent Bayesian stats for every tracked signal and
 * computes each one's actual contribution — the present-vs-absent average
 * return gap — rather than just reporting present-side win rate in
 * isolation (which can't distinguish "this signal has real edge" from
 * "everything was winning during the period this signal happened to fire").
 * Pure reporting — does not modify any stored weight or influence any
 * trading decision. See EXPERIMENTS.md E-08.
 */
export async function computeSignalContribution(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
): Promise<SignalContributionRow[]> {
  const { data } = await supabaseAdmin
    .from("agent_signal_weights")
    .select("*")
    .eq("user_id", userId);

  const rows: SignalContributionRow[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const signalName = String(r.signal_name);
    const presentAlpha = Number(r.alpha ?? 1);
    const presentBeta = Number(r.beta ?? 1);
    const presentSampleSize = Number(r.sample_size ?? 0);
    const presentAvgPnlPct = Number(r.avg_pnl_pct ?? 0);
    const absentAlpha = Number(r.absent_alpha ?? 1);
    const absentBeta = Number(r.absent_beta ?? 1);
    const absentSampleSize = Number(r.absent_sample_size ?? 0);
    const absentAvgPnlPct = Number(r.absent_avg_pnl_pct ?? 0);

    rows.push({
      signalName,
      presentSampleSize,
      presentWinRate: Number((presentAlpha / (presentAlpha + presentBeta)).toFixed(3)),
      presentAvgPnlPct: Number(presentAvgPnlPct.toFixed(3)),
      absentSampleSize,
      absentWinRate: Number((absentAlpha / (absentAlpha + absentBeta)).toFixed(3)),
      absentAvgPnlPct: Number(absentAvgPnlPct.toFixed(3)),
      contributionPct: Number((presentAvgPnlPct - absentAvgPnlPct).toFixed(3)),
      hasMinimumEvidence: presentSampleSize >= MIN_SAMPLE_FOR_COMPARISON && absentSampleSize >= MIN_SAMPLE_FOR_COMPARISON,
      isMutuallyExclusivePair: MUTUALLY_EXCLUSIVE_SIGNALS.has(signalName),
    });
  }

  return rows.sort((a, b) => b.presentSampleSize - a.presentSampleSize);
}
