import { createFileRoute } from "@tanstack/react-router";
import { fetchQuotePrice } from "@/lib/indicators";

/**
 * Emergency exit endpoint called by the client-side price watcher when a
 * live price hits a stop-loss or take-profit on an open position.
 * Unlike the scheduled exit-check cron (every 2h), this fires immediately.
 *
 * POST /api/public/emergency-exit
 * Body: { trade_id: string, current_price: number }
 * Auth: apikey header (anon key)
 */
export const Route = createFileRoute("/api/public/emergency-exit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as {
          trade_id?: string;
          current_price?: number;
        };
        if (!body.trade_id) {
          return Response.json({ ok: false, error: "missing trade_id" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Load trade
        const { data: trade, error: tErr } = await supabaseAdmin
          .from("paper_trades")
          .select("*")
          .eq("id", body.trade_id)
          .eq("is_open", true)
          .maybeSingle();

        if (tErr || !trade) {
          return Response.json({ ok: false, error: "trade not found or already closed" });
        }

        // Get fresh price (use provided price but verify with a live fetch)
        const livePrice = await fetchQuotePrice(String(trade.asset));
        const price = livePrice ?? body.current_price;
        if (!price) {
          return Response.json({ ok: false, error: "could not fetch price" });
        }

        const entry = Number(trade.entry_price);
        const qty = Number(trade.quantity);
        const isBuy = trade.side === "buy";
        const pnlPct = ((price - entry) / entry) * 100 * (isBuy ? 1 : -1);

        const stopPct = Number(trade.stop_loss_pct ?? 7);
        const targetPct = Number(trade.take_profit_pct ?? 15);

        const hitStop = pnlPct <= -stopPct;
        const hitTarget = pnlPct >= targetPct;
        const isEOD = (() => {
          const now = new Date();
          const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
          return trade.hold_duration === "intraday" && et.getHours() >= 15 && et.getMinutes() >= 30;
        })();

        if (!hitStop && !hitTarget && !isEOD) {
          return Response.json({ ok: true, action: "hold", pnl_pct: pnlPct });
        }

        const reason = hitStop ? "stop_loss_hit" : hitTarget ? "take_profit_hit" : "intraday_eod_close";
        const pnl = (price - entry) * qty * (isBuy ? 1 : -1);

        // Close the trade
        await supabaseAdmin.from("paper_trades").update({
          is_open: false,
          exit_price: price,
          pnl,
          closed_at: new Date().toISOString(),
        }).eq("id", trade.id);

        // Update portfolio cash
        const proceeds = qty * price;
        const { data: portfolio } = await supabaseAdmin
          .from("paper_portfolios")
          .select("id, balance")
          .eq("user_id", String(trade.user_id))
          .maybeSingle();
        if (portfolio) {
          const newCash = Number(portfolio.balance) + proceeds;
          await supabaseAdmin.from("paper_portfolios").update({
            balance: newCash,
            updated_at: new Date().toISOString(),
          }).eq("id", portfolio.id);
        }

        // Log execution
        await supabaseAdmin.from("signals_executions").insert({
          user_id: String(trade.user_id),
          strategy_id: trade.strategy_id ?? null,
          execution_type: "paper",
          status: "filled",
          asset: String(trade.asset),
          side: isBuy ? "sell" : "buy",
          quantity: qty,
          price,
          reason: `emergency_exit:${reason} pnl_pct=${pnlPct.toFixed(2)}`,
        });

        // Post agent message
        const emoji = hitStop ? "🛑" : hitTarget ? "✅" : "⏰";
        const label = hitStop ? "Stop loss hit" : hitTarget ? "Take profit hit" : "Intraday EOD close";
        await supabaseAdmin.from("agent_messages").insert({
          user_id: String(trade.user_id),
          role: "assistant",
          is_autonomous: true,
          session_type: "exit_check",
          content: `${emoji} **${label}** — ${trade.asset} closed at $${price.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}). Reason: ${reason.replace(/_/g, " ")}.`,
        });

        return Response.json({ ok: true, action: "closed", reason, pnl_pct: pnlPct, pnl });
      },
    },
  },
});
