// Experiment 1 (Claude Value Test) — pure observation infrastructure.
// Logs every candidate shown to Claude alongside its deterministic
// rank/score, and whether Claude's actual decision agreed or disagreed
// with what the deterministic system alone would have prioritized.
// NEVER changes what's actually traded — this module only writes shadow
// log rows, it never reads them back into a trading decision. See
// /project-audit/EXPERIMENTS.md E-01 and HYPOTHESIS_LOG.md H2.

// These functions write to tables (shadow_candidate_log,
// shadow_weighting_comparison) that are ahead of the auto-generated
// Database type — the migrations exist and are applied, but supabase
// codegen hasn't been re-run against the live schema to pick them up yet.
// A strict ReturnType<typeof createClient<Database>> parameter type would
// force every internal .from()/select()/insert() call in this file to
// fail type-checking against columns the codegen doesn't know about.
// Casting the argument at the CALL SITE (e.g. `supabaseAdmin as never`)
// does NOT fix this — the parameter's own declared type re-asserts
// strictness for all usage *inside* this function body regardless of what
// the caller passed. This was a real, previously-uncaught type-checking
// gap (127 errors accumulated silently — see BUG_TRACKER.md and the audit
// commit that found and fixed it). SupabaseAdminClient intentionally
// bypasses Database-schema strictness for exactly this reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdminClient = any;

type ShadowCandidateInput = {
  symbol: string;
  bull_score: number;
  bear_score: number;
  direction_hint: string; // "long" | "short" | "unclear"
  price?: number | null;
};

type ShadowTradeInput = {
  symbol: string;
  direction: "long" | "short";
  conviction: number;
};

/**
 * How many of the top deterministic-ranked candidates count as "what the
 * deterministic system would have traded" for agreement classification.
 * Chosen to roughly match how many positions a single scan typically opens
 * per the system prompts' own guidance (3-8 trades per scan) — not an
 * arbitrary number.
 */
const DETERMINISTIC_TOP_N = 6;

/**
 * How many days after logging a shadow row becomes eligible for resolution,
 * by session type. Scalp/crypto resolve fast (short holding periods this
 * platform actually uses for those sessions); swing sessions get more time
 * since a 1-3 day intended hold needs room to actually play out before
 * judging the outcome. Shared by both Experiment 1 and Experiment 2's
 * resolution logic — previously this map and the due-date check were
 * duplicated inline in resolve-shadow-experiments.ts (once per experiment),
 * a real DRY violation that could have drifted out of sync if one copy was
 * edited without the other. Extracted here as the single source of truth,
 * and as a pure function specifically so it's unit-testable without a live
 * database — see __tests__/resolution-horizon.test.ts.
 */
export const HORIZON_DAYS: Record<string, number> = {
  scalp_scan: 1,
  crypto_scan: 2,
  morning_scan: 4,
  midday_scan: 4,
  weekend_prep: 4,
};

/**
 * True once a shadow-logged row has aged past its session-appropriate
 * resolution horizon. Pure function of (sessionType, createdAt, now) —
 * no I/O, fully deterministic, exactly the kind of timestamp logic that
 * needs its own test rather than only being exercised indirectly inside
 * a route handler that also does real database calls.
 */
export function isResolutionDue(sessionType: string, createdAtIso: string, nowMs: number): boolean {
  const horizonDays = HORIZON_DAYS[sessionType] ?? 4;
  const createdAtMs = new Date(createdAtIso).getTime();
  if (!Number.isFinite(createdAtMs)) return false; // malformed timestamp — don't resolve on bad data
  const dueAtMs = createdAtMs + horizonDays * 86_400_000;
  return nowMs >= dueAtMs;
}

/**
 * Logs every candidate in the ranked pool (already sorted by combined
 * bull/bear strength before this is called — see autonomous-agent.ts's
 * `rescored`/`candidatesForAi` construction) against Claude's actual
 * trades for this scan. Best-effort: failures here must never interrupt
 * the real trading flow, since this is purely observational.
 */
export async function logShadowCandidates(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  sessionType: string,
  rankedCandidates: ShadowCandidateInput[],
  claudeTrades: ShadowTradeInput[],
): Promise<void> {
  try {
    const claudeBySymbol = new Map<string, ShadowTradeInput>();
    for (const t of claudeTrades) claudeBySymbol.set(t.symbol.toUpperCase(), t);

    const rows = rankedCandidates.map((c, idx) => {
      const rank = idx + 1; // 1-indexed, matches "top-ranked" language elsewhere
      const claudeTrade = claudeBySymbol.get(c.symbol.toUpperCase());
      const claudeTraded = claudeTrade != null;
      const isTopRanked = rank <= DETERMINISTIC_TOP_N;
      const detDirection = c.direction_hint === "short" ? "short" : "long"; // "unclear" defaults to long for comparison purposes, flagged via score being near-zero anyway

      let agreement: string;
      if (claudeTraded && isTopRanked) agreement = "agree_traded";
      else if (!claudeTraded && isTopRanked) agreement = "disagree_claude_skipped";
      else if (claudeTraded && !isTopRanked) agreement = "disagree_claude_added";
      else agreement = "agree_skipped";

      return {
        user_id: userId,
        session_type: sessionType,
        symbol: c.symbol,
        deterministic_rank: rank,
        deterministic_score: Number(Math.max(c.bull_score, c.bear_score).toFixed(2)),
        deterministic_direction: detDirection,
        claude_traded: claudeTraded,
        claude_direction: claudeTrade?.direction ?? null,
        claude_conviction: claudeTrade?.conviction ?? null,
        agreement,
        price_at_scan: c.price ?? null,
        resolved: false,
      };
    });

    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 50) {
      await supabaseAdmin.from("shadow_candidate_log").insert(rows.slice(i, i + 50) as never);
    }
  } catch (e) {
    console.warn("[shadow-experiments] logShadowCandidates failed (non-fatal)", String(e));
  }
}

/**
 * Links a shadow log row to the real paper_trades row when Claude actually
 * traded that candidate, so resolution can use the REAL outcome instead of
 * a hypothetical one for the "claude_traded" side of the comparison.
 * Best-effort, called right after a trade insert succeeds.
 */
export async function linkShadowCandidateToTrade(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  symbol: string,
  tradeId: string,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("shadow_candidate_log")
      .select("id")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("claude_traded", true)
      .is("actual_trade_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      await supabaseAdmin.from("shadow_candidate_log").update({ actual_trade_id: tradeId }).eq("id", data.id);
    }
  } catch (e) {
    console.warn("[shadow-experiments] linkShadowCandidateToTrade failed (non-fatal)", String(e));
  }
}

// ── Experiment 2 (Adaptive Learning Test) ───────────────────────────────

type WeightingComparisonInput = {
  symbol: string;
  adaptiveBullScore: number;
  adaptiveBearScore: number;
  neutralBullScore: number;
  neutralBearScore: number;
  adaptiveRank: number;  // 1-indexed rank under real weighting
  neutralRank: number;   // 1-indexed rank under hypothetical neutral weighting
  directionHint: string; // "long" | "short" | "unclear" — needed for resolution's hypothetical return
  price?: number | null;
};

/**
 * Shadow-logs the same candidate pool scored two ways: with the real,
 * adaptive per-signal weights actually in effect, and with all weights
 * held neutral (1.0x) as if the Bayesian learning system didn't exist.
 * The REAL system always trades based on adaptive scoring — this only
 * observes what would have ranked differently under neutral weighting,
 * for later comparison against outcomes. See HYPOTHESIS_LOG.md H3,
 * EXPERIMENTS.md E-02.
 */
export async function logWeightingComparison(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  sessionType: string,
  comparisons: WeightingComparisonInput[],
  tradedSymbols: Set<string>,
): Promise<void> {
  try {
    const rows = comparisons.map((c) => ({
      user_id: userId,
      session_type: sessionType,
      symbol: c.symbol,
      adaptive_bull_score: Number(c.adaptiveBullScore.toFixed(2)),
      adaptive_bear_score: Number(c.adaptiveBearScore.toFixed(2)),
      neutral_bull_score: Number(c.neutralBullScore.toFixed(2)),
      neutral_bear_score: Number(c.neutralBearScore.toFixed(2)),
      adaptive_rank: c.adaptiveRank,
      neutral_rank: c.neutralRank,
      rank_delta: c.neutralRank - c.adaptiveRank, // positive = adaptive weighting promoted this candidate
      direction_hint: c.directionHint === "short" ? "short" : "long",
      was_traded: tradedSymbols.has(c.symbol.toUpperCase()),
      price_at_scan: c.price ?? null,
      resolved: false,
    }));
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 50) {
      await supabaseAdmin.from("shadow_weighting_comparison").insert(rows.slice(i, i + 50) as never);
    }
  } catch (e) {
    console.warn("[shadow-experiments] logWeightingComparison failed (non-fatal)", String(e));
  }
}

/** Same linking pattern as Experiment 1, applied to the weighting-comparison table. */
export async function linkWeightingComparisonToTrade(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  symbol: string,
  tradeId: string,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("shadow_weighting_comparison")
      .select("id")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("was_traded", true)
      .is("actual_trade_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      await supabaseAdmin.from("shadow_weighting_comparison").update({ actual_trade_id: tradeId }).eq("id", data.id);
    }
  } catch (e) {
    console.warn("[shadow-experiments] linkWeightingComparisonToTrade failed (non-fatal)", String(e));
  }
}
