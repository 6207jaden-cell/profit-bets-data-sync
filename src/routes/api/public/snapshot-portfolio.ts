import { createFileRoute } from "@tanstack/react-router";
import { estimateOptionValue, fetchQuotePrice } from "@/lib/indicators";

export const Route = createFileRoute("/api/public/snapshot-portfolio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: portfolios, error } = await supabaseAdmin
          .from("paper_portfolios").select("user_id, balance, equity");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let inserted = 0;
        for (const p of portfolios ?? []) {
          // Load open positions to mark-to-market options with theta decay
          const { data: openTrades, count } = await supabaseAdmin
            .from("paper_trades")
            .select("id, asset, side, quantity, entry_price, instrument, options_details, created_at", { count: "exact" })
            .eq("user_id", p.user_id)
            .eq("is_open", true);

          let adjustedEquity = Number(p.equity ?? 0);
          const optionsTrades = (openTrades ?? []).filter((t) => {
            const instr = String(t.instrument ?? "stock").toLowerCase();
            return ["call", "put", "call_spread", "put_spread"].includes(instr);
          });

          if (optionsTrades.length > 0) {
            let equityAdjustment = 0;
            for (const trade of optionsTrades) {
              try {
                const underlying = String(trade.asset).replace("-USD","").toUpperCase();
                const currentPrice = await fetchQuotePrice(underlying);
                if (!currentPrice) continue;

                const details = trade.options_details as {
                  resolved_contract?: { strike?: number; days_to_expiry?: number; implied_volatility?: number };
                } | null;
                const strike = details?.resolved_contract?.strike ?? currentPrice;
                const entryDate = new Date(String(trade.created_at));
                const daysSinceEntry = (Date.now() - entryDate.getTime()) / 86400_000;
                const originalDTE = details?.resolved_contract?.days_to_expiry ?? 21;
                const currentDTE = Math.max(0, originalDTE - daysSinceEntry);
                const iv = details?.resolved_contract?.implied_volatility ?? 0.30;
                const instr = String(trade.instrument ?? "call").toLowerCase();
                const optType = instr.includes("put") ? "put" : "call";

                const currentValue = estimateOptionValue({
                  underlying_price: currentPrice,
                  strike,
                  days_to_expiry: currentDTE,
                  implied_vol: iv,
                  risk_free_rate: 0.05,
                  option_type: optType,
                });

                const entryValue = Number(trade.entry_price) * Number(trade.quantity);
                const currentTotal = currentValue * Number(trade.quantity);
                equityAdjustment += (currentTotal - entryValue);

                // Update entry_price to reflect current theoretical value for P&L display
                if (currentValue > 0 && Math.abs(currentValue - Number(trade.entry_price)) / Number(trade.entry_price) > 0.02) {
                  await supabaseAdmin.from("paper_trades").update({
                    entry_price: currentValue,
                  }).eq("id", trade.id);
                }
              } catch { /* skip on error */ }
            }
            adjustedEquity += equityAdjustment;
          }

          const { error: iErr } = await supabaseAdmin.from("portfolio_snapshots").insert({
            user_id: p.user_id,
            equity: adjustedEquity,
            cash: Number(p.balance ?? 0),
            open_positions: count ?? 0,
          });
          if (!iErr) inserted++;
        }
        return Response.json({ ok: true, inserted });
      },
    },
  },
});
