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
