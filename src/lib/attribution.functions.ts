// Stage 3 attribution — thin server-function wrappers around
// computeSignalAttribution (signal-learning.ts) and computeClaudeAttribution
// (shadow-experiments.ts). Uses the RLS-scoped context.supabase client
// (requireSupabaseAuth), not supabaseAdmin — both underlying tables
// (paper_trades, shadow_candidate_log) already have "users read own rows"
// policies from when they were first created, so no service-role access
// is needed here, consistent with how the rest of the client-facing
// analytics in this project work.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeSignalAttribution } from "@/lib/signal-learning";
import { computeClaudeAttribution, computeLearningAttribution } from "@/lib/shadow-experiments";
import { computePortfolioAttribution } from "@/lib/portfolio-attribution";
import { computeRiskAttribution } from "@/lib/performance-metrics";

export const getSignalAttribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return computeSignalAttribution(context.supabase, context.userId);
  });

export const getClaudeAttribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return computeClaudeAttribution(context.supabase, context.userId);
  });

export const getLearningAttribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return computeLearningAttribution(context.supabase, context.userId);
  });

export const getPortfolioAttribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return computePortfolioAttribution(context.supabase, context.userId);
  });

/**
 * Risk Attribution — the 5th of the originally-requested attribution
 * categories (item 13b, TECHNICAL_DEBT.md TD-12 correction). Unlike the
 * other four, which decompose P&L, this decomposes RISK — the population
 * standard deviation of each symbol's own trade returns. No stored
 * pnl_pct column exists on paper_trades, so it's computed here from
 * entry_price/exit_price/side, the same formula used elsewhere in this
 * project (e.g. regime-performance.functions.ts) for consistency.
 */
export const getRiskAttribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("paper_trades")
      .select("asset, side, entry_price, exit_price")
      .eq("user_id", context.userId)
      .eq("is_open", false)
      .not("exit_price", "is", null);
    if (error || !data) return [];

    const trades = (data as Array<{ asset: string; side: string; entry_price: number; exit_price: number }>)
      .filter((t) => t.entry_price > 0)
      .map((t) => {
        const dir = t.side === "buy" ? 1 : -1;
        const pnlPct = ((t.exit_price - t.entry_price) / t.entry_price) * 100 * dir;
        return { symbol: t.asset, pnlPct };
      });

    return computeRiskAttribution(trades);
  });
