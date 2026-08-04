// Market breadth: what fraction of the scanned universe is actually
// participating in the current move, versus a handful of large names
// dragging an index around. A single stock's technicals can look great
// while the broader market is quietly deteriorating underneath it — breadth
// catches that before it shows up in any one candidate's own indicators.
//
// Built from our own scanned universe (100+ stocks across every major
// sector) rather than a literal NYSE-wide feed, since we already have this
// data in hand from the per-symbol scan with zero extra API calls. This is
// a genuine, honest proxy — not the full 2,800-name NYSE tape, but a broad,
// diversified sample that moves the same direction the real thing does the
// overwhelming majority of the time.
//
// Composite of 3 measures (renormalized from an original 4-factor design
// after deliberately dropping a put/call ratio component — we don't have a
// reliable market-wide options put/call feed without a new paid data
// source, and approximating one from mismatched per-symbol data would be
// worse than just not including it):
//   - Advance/decline ratio (44%): % of scanned symbols up on the day
//   - % above their own 50-day MA (33%): breadth of the underlying trend
//   - New 220-day-high vs 220-day-low ratio (23%): breadth of extremes,
//     proxy for the classic "52-week highs vs lows" breadth measure —
//     220 trading days is what we already fetch per symbol, not literally
//     52 weeks, but close and consistent with data already in hand

export type BreadthCandidate = {
  one_day_return: number;
  momentum_pct: number; // price vs SMA50, % — positive means above SMA50
  is_220d_high: boolean;
  is_220d_low: boolean;
};

export type BreadthResult = {
  breadthScore: number; // 0-100
  adRatioPct: number;
  aboveSma50Pct: number;
  newHighLowRatio: number; // -1 (all new lows) to +1 (all new highs)
  interpretation: string;
};

export function computeBreadthScore(candidates: BreadthCandidate[]): BreadthResult {
  if (candidates.length === 0) {
    return { breadthScore: 50, adRatioPct: 50, aboveSma50Pct: 50, newHighLowRatio: 0, interpretation: "insufficient scan data, assuming neutral" };
  }

  const advancing = candidates.filter((c) => c.one_day_return > 0).length;
  const adRatioPct = (advancing / candidates.length) * 100;

  const aboveSma50 = candidates.filter((c) => c.momentum_pct > 0).length;
  const aboveSma50Pct = (aboveSma50 / candidates.length) * 100;

  const newHighs = candidates.filter((c) => c.is_220d_high).length;
  const newLows = candidates.filter((c) => c.is_220d_low).length;
  const totalExtremes = newHighs + newLows;
  const newHighLowRatio = totalExtremes > 0 ? (newHighs - newLows) / totalExtremes : 0;
  const newHighLowScore = (newHighLowRatio + 1) * 50; // normalize -1..1 to 0..100

  const breadthScore = Math.round(adRatioPct * 0.44 + aboveSma50Pct * 0.33 + newHighLowScore * 0.23);

  const interpretation =
    breadthScore < 25 ? "very weak — broad-based selling, elevated risk of catching falling knives on new longs"
    : breadthScore < 40 ? "weak — more of the scanned universe declining than advancing"
    : breadthScore < 60 ? "neutral/mixed"
    : breadthScore < 75 ? "healthy — broad-based participation"
    : "very strong — most of the scanned universe advancing together";

  return {
    breadthScore,
    adRatioPct: Number(adRatioPct.toFixed(1)),
    aboveSma50Pct: Number(aboveSma50Pct.toFixed(1)),
    newHighLowRatio: Number(newHighLowRatio.toFixed(2)),
    interpretation,
  };
}

/**
 * Stores the current breadth score and compares it against a reading from
 * ~3 hours ago to determine momentum — is breadth improving or deteriorating,
 * not just where it happens to sit right now. A breadth score of 45 that's
 * falling from 70 is a materially different, more dangerous market than a 45
 * that's recovering from 20, even though the raw level is identical.
 */
export async function getBreadthMomentum(
  supabaseAdmin: { from: (table: string) => any },
  currentScore: number,
): Promise<{ current: number; changeVs3hAgo: number; trend: "improving" | "deteriorating" | "stable" }> {
  try {
    await supabaseAdmin.from("market_breadth_snapshots").insert({ breadth_score: currentScore });
  } catch { /* best-effort */ }

  let changeVs3hAgo = 0;
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    const { data: prior } = await supabaseAdmin
      .from("market_breadth_snapshots")
      .select("breadth_score, created_at")
      .lte("created_at", threeHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior) changeVs3hAgo = currentScore - Number(prior.breadth_score);
  } catch { /* stays 0 if no history yet */ }

  const trend: "improving" | "deteriorating" | "stable" =
    changeVs3hAgo > 5 ? "improving" : changeVs3hAgo < -5 ? "deteriorating" : "stable";

  return { current: currentScore, changeVs3hAgo: Number(changeVs3hAgo.toFixed(1)), trend };
}
