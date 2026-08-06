import { createFileRoute } from "@tanstack/react-router";
import { fetchQuotePrice } from "@/lib/indicators";
import { isResolutionDue } from "@/lib/shadow-experiments";
import { enforceRateLimit, endpointBucketKey, resolveRateLimit } from "@/lib/rate-limit";
import { verifyPublicApiKeyFromEnv, unauthorizedResponse } from "@/lib/api-auth";

// Experiment 1 (Claude Value Test) resolution job. Finds shadow_candidate_log
// rows past their session-appropriate horizon and resolves them:
//   - If Claude actually traded the candidate (actual_trade_id is set) and
//     that trade has since closed, use its REAL realized P&L% — the fairest
//     comparison, actual outcome vs actual outcome.
//   - If Claude did NOT trade it, compute a hypothetical "bought at scan
//     price, held to horizon" return — a simplified proxy, not a full
//     backtest simulation (no stop/target simulation), documented as such
//     in EXPERIMENTS.md E-01.
// Runs on its own cron, separate from the entry/exit crons, since it reads
// old data rather than making trading decisions.
// Horizon-by-session-type logic lives in shadow-experiments.ts's
// isResolutionDue() — previously duplicated inline here twice (once per
// experiment's resolution loop below), extracted to a single tested source
// of truth.

export const Route = createFileRoute("/api/public/resolve-shadow-experiments")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!verifyPublicApiKeyFromEnv(request)) return unauthorizedResponse();
        const { supabaseAdmin: typedSupabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Cast once here: this route reads/writes shadow_candidate_log and
        // shadow_weighting_comparison, tables ahead of the auto-generated
        // Database type (migrations applied, codegen not yet re-run). See
        // the SupabaseAdminClient comment in shadow-experiments.ts for the
        // full explanation — same root cause, same fix, applied at the
        // point this route obtains its client instead of inside a shared
        // library function's signature.
        const supabaseAdmin = typedSupabaseAdmin as any;
        // Daily cron — very low legitimate frequency, tight limit.
        const rl = resolveRateLimit(3, 3600);
        const rateLimited = await enforceRateLimit(supabaseAdmin, {
          key: endpointBucketKey("resolve-shadow-experiments"), maxRequests: rl.maxRequests, windowSeconds: rl.windowSeconds,
        });
        if (rateLimited) return rateLimited;

        const { data: pending } = await supabaseAdmin
          .from("shadow_candidate_log")
          .select("*")
          .eq("resolved", false)
          .order("created_at", { ascending: true })
          .limit(200); // bounded per run — resolution isn't time-critical

        if (!pending || pending.length === 0) {
          return Response.json({ ok: true, resolved: 0, checked: 0 });
        }

        let resolvedCount = 0;
        const now = Date.now();

        for (const row of pending as Array<Record<string, unknown>>) {
          try {
            const sessionType = String(row.session_type);
            if (!isResolutionDue(sessionType, String(row.created_at), now)) continue; // not due for resolution yet

            const symbol = String(row.symbol);
            const priceAtScan = row.price_at_scan != null ? Number(row.price_at_scan) : null;
            const direction = String(row.deterministic_direction);
            const dirMult = direction === "short" ? -1 : 1;

            // Case 1: Claude actually traded this — use the real trade's
            // outcome if it has closed. If still open past the horizon,
            // skip resolving this row for now (check again next run) rather
            // than resolving prematurely on an open position.
            if (row.actual_trade_id) {
              const { data: trade } = await supabaseAdmin
                .from("paper_trades")
                .select("is_open, entry_price, exit_price, side")
                .eq("id", String(row.actual_trade_id))
                .maybeSingle();
              if (!trade) continue;
              if (trade.is_open) continue; // still open, wait for a future run
              const entry = Number(trade.entry_price);
              const exit = Number(trade.exit_price ?? entry);
              const realDir = trade.side === "buy" ? 1 : -1;
              const realizedPct = entry > 0 ? ((exit - entry) / entry) * 100 * realDir : 0;
              await supabaseAdmin.from("shadow_candidate_log").update({
                resolved: true,
                resolved_at: new Date().toISOString(),
                resolution_price: exit,
                hypothetical_return_pct: Number(realizedPct.toFixed(3)),
              }).eq("id", String(row.id));
              resolvedCount++;
              continue;
            }

            // Case 2: Claude did not trade it — compute a hypothetical
            // buy-at-scan, hold-to-horizon return using the current quote.
            if (priceAtScan == null || priceAtScan <= 0) {
              // Can't compute a hypothetical without a scan-time price —
              // mark resolved with a null return rather than leaving it
              // stuck unresolved forever.
              await supabaseAdmin.from("shadow_candidate_log").update({
                resolved: true, resolved_at: new Date().toISOString(),
              }).eq("id", String(row.id));
              resolvedCount++;
              continue;
            }

            const currentPrice = await fetchQuotePrice(symbol);
            if (!currentPrice) continue; // price fetch failed, try again next run

            const hypotheticalPct = ((currentPrice - priceAtScan) / priceAtScan) * 100 * dirMult;
            await supabaseAdmin.from("shadow_candidate_log").update({
              resolved: true,
              resolved_at: new Date().toISOString(),
              resolution_price: currentPrice,
              hypothetical_return_pct: Number(hypotheticalPct.toFixed(3)),
            }).eq("id", String(row.id));
            resolvedCount++;
          } catch (e) {
            console.warn("[resolve-shadow-experiments] failed to resolve row", row.id, String(e));
          }
        }

        // ── Experiment 2 (Adaptive Learning Test) resolution ──────────────
        // Same pattern as Experiment 1 above, applied to the weighting-
        // comparison table. Resolves each row's hypothetical (or, if traded,
        // real) return so rank_delta can later be correlated against outcome.
        const { data: pendingWeighting } = await supabaseAdmin
          .from("shadow_weighting_comparison")
          .select("*")
          .eq("resolved", false)
          .order("created_at", { ascending: true })
          .limit(200);

        let resolvedWeightingCount = 0;
        for (const row of (pendingWeighting ?? []) as Array<Record<string, unknown>>) {
          try {
            const sessionType = String(row.session_type);
            if (!isResolutionDue(sessionType, String(row.created_at), now)) continue;

            const symbol = String(row.symbol);
            const priceAtScan = row.price_at_scan != null ? Number(row.price_at_scan) : null;
            const dirMult = String(row.direction_hint) === "short" ? -1 : 1;

            if (row.actual_trade_id) {
              const { data: trade } = await supabaseAdmin
                .from("paper_trades")
                .select("is_open, entry_price, exit_price, side")
                .eq("id", String(row.actual_trade_id))
                .maybeSingle();
              if (!trade) continue;
              if (trade.is_open) continue;
              const entry = Number(trade.entry_price);
              const exit = Number(trade.exit_price ?? entry);
              const realDir = trade.side === "buy" ? 1 : -1;
              const realizedPct = entry > 0 ? ((exit - entry) / entry) * 100 * realDir : 0;
              await supabaseAdmin.from("shadow_weighting_comparison").update({
                resolved: true, resolved_at: new Date().toISOString(),
                resolution_price: exit, hypothetical_return_pct: Number(realizedPct.toFixed(3)),
              }).eq("id", String(row.id));
              resolvedWeightingCount++;
              continue;
            }

            if (priceAtScan == null || priceAtScan <= 0) {
              await supabaseAdmin.from("shadow_weighting_comparison").update({
                resolved: true, resolved_at: new Date().toISOString(),
              }).eq("id", String(row.id));
              resolvedWeightingCount++;
              continue;
            }

            const currentPrice = await fetchQuotePrice(symbol);
            if (!currentPrice) continue;

            const hypotheticalPct = ((currentPrice - priceAtScan) / priceAtScan) * 100 * dirMult;
            await supabaseAdmin.from("shadow_weighting_comparison").update({
              resolved: true, resolved_at: new Date().toISOString(),
              resolution_price: currentPrice, hypothetical_return_pct: Number(hypotheticalPct.toFixed(3)),
            }).eq("id", String(row.id));
            resolvedWeightingCount++;
          } catch (e) {
            console.warn("[resolve-shadow-experiments] failed to resolve weighting row", row.id, String(e));
          }
        }

        return Response.json({
          ok: true,
          experiment1: { resolved: resolvedCount, checked: pending.length },
          experiment2: { resolved: resolvedWeightingCount, checked: (pendingWeighting ?? []).length },
        });
      },
    },
  },
});