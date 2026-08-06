// Stage 3 exposure — thin server-function wrapper around computeExposure
// (exposure.ts). Uses the RLS-scoped context.supabase client, consistent
// with the other Stage 3 server functions — paper_portfolios and
// paper_trades already have "users read own rows" policies.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeExposure } from "@/lib/exposure";

export const getExposure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return computeExposure(context.supabase, context.userId);
  });
