import { createFileRoute } from "@tanstack/react-router";
import { fetchQuotePrice } from "@/lib/indicators";

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

const HORIZON_DAYS: Record<string, number> = {
  scalp_scan: 1,
  crypto_scan: 2,
  morning_scan: 4,
  midday_scan: 4,
  weekend_prep: 4,
};

export const Route = createFileRoute("/api/public/resolve-shadow-experiments")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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
            const horizonDays = HORIZON_DAYS[sessionType] ?? 4;
            const createdAt = new Date(String(row.created_at)).getTime();
            const dueAt = createdAt + horizonDays * 86_400_000;
            if (now < dueAt) continue; // not due for resolution yet

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

        return Response.json({ ok: true, resolved: resolvedCount, checked: pending.length });
      },
    },
  },
});
